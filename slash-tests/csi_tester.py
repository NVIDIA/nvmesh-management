# pylint: disable=line-too-long
# pylint: disable=logging-fstring-interpolation,logging-not-lazy

"""
CSI Driver Integration Tests.

This test will run test code from nvmesh-csi-driver project against a management server.
use ci_settings.yaml file to determine the branch of the nvmesh-csi-driver project to use.

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

def git_clone_repo(parent_dir, repo_url, repo_name):
    """
    Clone a repository into the current directory.
    """
    logger.info(f"Cloning repository {repo_name} from {repo_url} into {parent_dir}")
    result = subprocess.run(
        ["git", "clone", repo_url, repo_name],
        cwd=parent_dir,
        capture_output=True,
        check=False
    )
    if result.returncode != 0:
        raise RuntimeError(f"Failed to clone repository.\nstdout: {result.stdout}\nstderr: {result.stderr}")
    return os.path.abspath(os.path.join(parent_dir, repo_name))

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
        # Create venv with Python 3.9
        result = subprocess.run(
            ["python3.9", "-m", "venv", venv_path],
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
    # Build pytest command
    pytest_cmd = [
        python_bin,
        "-m", "pytest",
        test_path,
        f"--rootdir={csi_driver_root}",
    ]

    pytest_cmd.extend(pytest_args)

    logger.info("Running command:")
    logger.info(" ".join(pytest_cmd))
    logger.info("=" * 70)

    # Run pytest in subprocess with CSI driver's venv
    result = subprocess.run(
        pytest_cmd,
        cwd=csi_driver_root,
        env={
            **os.environ,
            "PYTHONPATH": csi_driver_root,
            "PROJECT_ROOT": csi_driver_root,
            "TEST_CONFIG_PATH": os.path.join(csi_driver_root, "test/config.yaml"),
        },
        check=False
    )

    return result

def ensure_csi_driver_cloned(branch_name):
    """
    Ensure the nvmesh-csi-driver project is cloned.
    """
    project_dir_name = "nvmesh-csi-driver"
    if os.path.exists(os.path.join(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")), project_dir_name)):
        logger.info(f"Repository {project_dir_name} already exists at {os.path.abspath(os.path.join(os.path.dirname(__file__), '../../', project_dir_name))}")
        return os.path.abspath(os.path.join(os.path.dirname(__file__), "../../", project_dir_name))

    csi_driver_root = git_clone_repo(
        parent_dir=os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")),
        repo_url=CSI_REPO_URL,
        repo_name=project_dir_name)

    # Checkout the branch
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

def get_ci_settings():
    """
    Read the ci_settings.yaml file.
    """
    ci_settings_path = os.path.join(os.path.dirname(__file__), "../ci_settings.yaml")
    try:
        with open(ci_settings_path, "r", encoding="utf-8") as f:
            ci_settings = yaml.safe_load(f)
        return ci_settings
    except FileNotFoundError:
        raise RuntimeError(f"CI settings file not found at {ci_settings_path}")
    except yaml.YAMLError as e:
        raise RuntimeError(f"Failed to parse CI settings YAML: {e}")

# pylint: disable=redefined-outer-name
def update_test_config(csi_driver_root, manager):
    """
    Update the test/config.yaml file with the management address.
    """

    # Load config file
    test_config_path = os.path.join(csi_driver_root, "test/config.yaml")
    with open(test_config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    # set mgmt API params
    config["mgmtIntegration"] = {
        "apiParams": {
            "managementServers": ",".join(manager.endpoints),
            "managementProtocol": "http",
            "user": "admin@nvidia.com",
            "password": "admin",
            "tlsVerify": False
        }
    }

    with open(test_config_path, "w", encoding="utf-8") as f:
        yaml.dump(config, f)

# pylint: disable=redefined-outer-name,unused-argument
def test_csi_driver(manager, simulator):
    """
    Run CSI driver management integration tests in an isolated subprocess
    with the CSI driver's own virtual environment.
    """

    # Ensure the project is cloned
    ci_settings = get_ci_settings()
    csi_branch = ci_settings.get("build-with", {}).get("csi-driver", "master")
    csi_driver_root = ensure_csi_driver_cloned(branch_name=csi_branch)

    # Ensure venv exists and has all dependencies
    python_bin = ensure_csi_venv(csi_driver_root)

    # set the mgmt address in the test/config.yaml
    update_test_config(csi_driver_root, manager)

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
