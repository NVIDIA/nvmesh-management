# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# pylint: disable=line-too-long
# pylint: disable=logging-fstring-interpolation,logging-not-lazy

"""
CSI Driver Integration Tests.

This test will run test code from nvmesh-csi-driver project against a management server.

The CSI driver checkout is expected on disk at ../nvmesh-csi-driver relative to the process working
directory. If it is missing, this tester will clone it from CSI_REPO_URL onto the branch configured
in ci_settings.yaml (build-with.nvmesh-csi-driver, default "master").

The test covers only basic API operations used in the CSI Driver,
Create / Delete Volume operations, and Attach / Detach functionality.

The full code for the tests is available in the CSI Driver repository under test/mgmt_integration directory.
https://gitlab-master.nvidia.com/excelero/nvmesh-csi-driver/-/tree/master/test/mgmt_integration
"""

# pylint: disable=unused-import
import logging
import os
import subprocess

from xlro.infra.fixtures import manager, simulator
import slash
import yaml

logger = logging.getLogger("csi-tester")

CSI_REPO_URL = "ssh://git@gitlab-master.nvidia.com:12051/excelero/nvmesh-csi-driver.git"


def csi_driver_root_from_workdir():
    """
    nvmesh-csi-driver checkout is always ../nvmesh-csi-driver relative to cwd.

    Slash/CI must set the working directory so that path exists (typically repo root beside the CSI clone).
    """
    root = os.path.realpath(os.path.join(os.getcwd(), "..", "nvmesh-csi-driver"))
    logger.info("CSI driver root=%s (cwd=%s)", root, os.getcwd())
    return root


def git_clone_repo(parent_dir, repo_url, repo_name):
    """
    Clone a repository into parent_dir under the given repo_name.
    """
    logger.info(f"Cloning repository {repo_name} from {repo_url} into {parent_dir}")
    os.makedirs(parent_dir, exist_ok=True)
    result = subprocess.run(
        ["git", "clone", repo_url, repo_name],
        cwd=parent_dir,
        capture_output=True,
        check=False
    )
    if result.returncode != 0:
        raise RuntimeError(f"Failed to clone repository.\nstdout: {result.stdout}\nstderr: {result.stderr}")
    return os.path.abspath(os.path.join(parent_dir, repo_name))


def get_ci_settings():
    """
    Read the ci_settings.yaml file.
    """
    ci_settings_path = os.path.join(os.path.dirname(__file__), "../ci_settings.yaml")
    try:
        with open(ci_settings_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    except FileNotFoundError as e:
        raise RuntimeError(f"CI settings file not found at {ci_settings_path}") from e
    except yaml.YAMLError as e:
        raise RuntimeError(f"Failed to parse CI settings YAML: {e}") from e


def ensure_csi_driver_cloned(csi_driver_root, branch_name):
    """
    Ensure the nvmesh-csi-driver project is cloned at csi_driver_root on the requested branch.

    No-op if the directory already exists (Slash/CI may have cloned it already).
    """
    if os.path.exists(csi_driver_root):
        logger.info(f"Repository already exists at {csi_driver_root}")
        return csi_driver_root

    parent_dir = os.path.dirname(csi_driver_root)
    repo_name = os.path.basename(csi_driver_root)
    git_clone_repo(parent_dir=parent_dir, repo_url=CSI_REPO_URL, repo_name=repo_name)

    logger.info(f"Checking out branch {branch_name} in {csi_driver_root}")
    res = subprocess.run(
        ["git", "checkout", branch_name],
        cwd=csi_driver_root,
        capture_output=True,
        text=True,
        check=False
    )
    if res.returncode != 0:
        raise RuntimeError(f"Failed to checkout branch {branch_name} in {csi_driver_root}: {res.stdout} {res.stderr}")

    return csi_driver_root


def ensure_csi_venv(csi_driver_root):
    """
    Ensure the CSI driver has a virtual environment with all dependencies installed.
    Returns the path to the venv's python interpreter.
    """
    venv_path = os.path.join(csi_driver_root, ".venv")
    python_bin = os.path.join(venv_path, "bin", "python")

    # Check if venv exists and has python
    if not os.path.exists(python_bin):
        logger.info(f"Creating virtual environment at {venv_path}...")
        # Create venv with Python 3.13 (matches the CSI driver runtime / its pyproject deps)
        result = subprocess.run(
            ["python3.13", "-m", "venv", venv_path],
            cwd=csi_driver_root,
            capture_output=True,
            text=True,
            check=False
        )
        if result.returncode != 0:
            raise RuntimeError(f"Failed to create venv: {result.stderr}")
        logger.info("Virtual environment created")

    # Check if dependencies are installed (check for pytest)
    check_pytest = subprocess.run(
        [python_bin, "-c", "import pytest"],
        capture_output=True,
        check=False
    )

    if check_pytest.returncode != 0:
        logger.info("Installing dependencies from pyproject.toml...")

        # Upgrade pip first
        pip_upgrade = subprocess.run(
            [python_bin, "-m", "pip", "install", "--upgrade", "pip"],
            cwd=csi_driver_root,
            capture_output=True,
            text=True,
            check=False
        )
        if pip_upgrade.returncode != 0:
            logger.warning(f"Warning: pip upgrade failed: STDOUT: {pip_upgrade.stdout} \nSTDERR: {pip_upgrade.stderr}")
            # Continue anyway as pip might still work

        # Install dependencies using venv's pip directly
        pip_bin = os.path.join(venv_path, "bin", "pip")
        result = subprocess.run(
            [pip_bin, "install", ".[dev]"],
            cwd=csi_driver_root,
            capture_output=True,
            text=True,
            check=False
        )
        if result.returncode != 0:
            raise RuntimeError(f"Failed to install dependencies: STDOUT: {result.stdout} \nSTDERR: {result.stderr}")
        logger.info("Dependencies installed")
    else:
        logger.info("Virtual environment already set up with dependencies")

    return python_bin

def run_csi_driver_pytests(csi_driver_root, python_bin, test_path, pytest_args):
    """
    Run CSI driver management integration tests in an isolated subprocess
    with the CSI driver's own virtual environment.
    """
    root_pytest = os.path.realpath(os.path.abspath(csi_driver_root))
    test_config_abs = os.path.join(root_pytest, "test", "config.yaml")

    # Build pytest command
    pytest_cmd = [
        python_bin,
        "-m", "pytest",
        test_path,
        f"--rootdir={root_pytest}",
    ]

    pytest_cmd.extend(pytest_args)

    logger.info("Running command:")
    logger.info(" ".join(pytest_cmd))
    logger.info("=" * 70)
    logger.info("Pytest CSI driver root=%s TEST_CONFIG_PATH=%s", root_pytest, test_config_abs)

    env = {
        **os.environ,
        "PYTHONPATH": root_pytest,
        "PROJECT_ROOT": root_pytest,
        "TEST_CONFIG_PATH": test_config_abs,
    }

    # Stream pytest output line-by-line (merged stderr) while capturing for the result object
    stdout_lines = []

    with subprocess.Popen(
        pytest_cmd,
        cwd=root_pytest,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    ) as proc:
        if proc.stdout is None:
            raise RuntimeError("pytest subprocess has no stdout pipe")
        for line in proc.stdout:
            stdout_lines.append(line)
            logger.info("%s", line.rstrip("\n"))

    return subprocess.CompletedProcess(
        pytest_cmd, proc.returncode, stdout="".join(stdout_lines), stderr=None
    )

# pylint: disable=redefined-outer-name
def create_test_config(csi_driver_root, manager):
    """
    Create the test/config.yaml file with the management address.
    """
    root = os.path.realpath(os.path.abspath(csi_driver_root))
    test_dir = os.path.join(root, "test")
    template_path = os.path.join(test_dir, "config-template.yaml")
    output_path = os.path.join(test_dir, "config.yaml")
    os.makedirs(test_dir, exist_ok=True)

    with open(template_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    api_params = {
        "managementServers": ",".join(manager.endpoints),
        "managementProtocol": "http",
        "user": "admin@nvidia.com",
        "password": "admin",
        "tlsVerify": False
    }
    # pytest_configure loads integration.* into TestConfig; mgmt tests read mgmtIntegration.*
    config["mgmtIntegration"] = {"apiParams": api_params}
    integration = config.get("integration")
    if isinstance(integration, dict):
        integration["apiParams"] = api_params
    else:
        config["integration"] = {"apiParams": api_params}

    logger.info("Writing CSI pytest config %s from template %s", output_path, template_path)
    with open(output_path, "w", encoding="utf-8") as f:
        yaml.dump(config, f)

    if not os.path.isfile(output_path):
        raise RuntimeError("CSI test config was not written (expected file at %r)" % (output_path,))

# pylint: disable=redefined-outer-name,unused-argument
def test_csi_driver(manager, simulator):
    """
    Run CSI driver management integration tests in an isolated subprocess
    with the CSI driver's own virtual environment.
    """

    csi_driver_root = csi_driver_root_from_workdir()

    # Ensure the project is cloned (no-op if Slash/CI already cloned it)
    ci_settings = get_ci_settings()
    csi_branch = ci_settings.get("build-with", {}).get("nvmesh-csi-driver", "master")
    ensure_csi_driver_cloned(csi_driver_root, branch_name=csi_branch)

    # Ensure venv exists and has all dependencies
    python_bin = ensure_csi_venv(csi_driver_root)

    # set the mgmt address in the test/config.yaml
    create_test_config(csi_driver_root, manager)

    logger.info("Running CSI Driver Management Integration Tests")

    logdir = slash.context.result.get_log_dir()
    log_file_path = os.path.abspath(os.path.join(logdir, "csi_mgmt_ci.log"))

    pytest_args = [
        "-v",                           # Verbose
        "-s",                           # Show output
        "--tb=long",                    # Long traceback
        "-m", "ci_mgmt",                # Run tests by markers
        "--log-file=" + log_file_path,  # log file
        "--log-file-level=DEBUG",       # log level for log file
        "--log-cli-level=INFO",         # CLI log level
        "--log-file-date-format=%Y-%m-%d %H:%M:%S",  # timestamps for log file
    ]

    test_path = "test/mgmt_integration"
    result = run_csi_driver_pytests(csi_driver_root, python_bin, test_path, pytest_args)

    text_result = "PASSED" if result.returncode == 0 else "FAILED"
    logger.info("CSI Driver Integration Tests %s", text_result)
    logger.info("Debug Log file: %s", log_file_path)

    if result.returncode != 0:
        raise RuntimeError(f"CSI Driver Integration Tests failed with return code {result.returncode}")

    return result.returncode
