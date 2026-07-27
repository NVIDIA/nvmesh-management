# Running Management Slash-Tests with a Debugger

Welcome to the guide for running **slash-tests** in the management project! 
These tests are designed for local debugging and development and are also part of the CI pipeline triggered by new merge requests in the management project. 🚀 

This guide provides step-by-step instructions to set up your own environment and run these tests with a debugger.

This README covers:
- Setting up your environment.
- Configuring your IDE (VSCode/WebStorm).
- Running the tests efficiently.

Let's get started! 😄

---

## Prerequisites

Before you begin, ensure you have the following:

1. **Python 3.9** and the Python 3.9 developer package installed.
2. **Poetry** (for managing Python dependencies):
   ```bash
   curl -sSL https://install.python-poetry.org | python3
   ```
   Add Poetry to your PATH by appending this line to your shell configuration file (e.g., `~/.bashrc`, `~/.zshrc`):
   ```bash
   export PATH="$HOME/.local/bin:$PATH"
   ```
3. Git access to the infrastructure repository:
   ```bash
   cd ~/projects/
   git clone ssh://git@gitlab-master.nvidia.com:12051/excelero/infrastructure.git ~/projects/infrastructure
   ```

---

## Environment Setup

1. **Create a poetry virtual environment for the infrastructure project:**
   ```bash
   cd ~/projects/infrastructure
   poetry env use 3.9
   poetry sync
   ```

2. **(Optional) Shell Integration:** If you want to use the infrastructure environment from the shell, add the following lines to your shell configuration file (e.g., `~/.bashrc`, `~/.zshrc`):
   ```bash
   export PYTHONPATH=~/projects/infrastructure
   export SLASH_USER_SETTINGS=~/projects/infrastructure/xlro/infra/config/global-slashrc
   ```

---

## Debugger Setup

### VSCode

Add the following configuration to your `launch.json` in the management project:

```json
{
    "name": "slash tests",
    "type": "debugpy",
    "request": "launch",
    "python": "path/to/python", // Should be taked from the output of `poetry env info --executable` when run from the infrastructure repository.
    "cwd": "${workspaceFolder}/slash-tests/",
    "module": "slash.frontend.main",
    "args": [
        "run",
        "test/to/run", // Update this to match the test you want to run
        "-c",
        "cluster.management=hostname", // Update this to the management hostname to connect to
        "-l",
        "/tmp/infra-logs",
        "--force",
        "--nocollect",
        "-vvv",
        "--notimesync"
    ],
    "env": {
        "PYTHONPATH": "${userHome}/projects/infrastructure",
        "SLASH_USER_SETTINGS": "${userHome}/projects/infrastructure/xlro/infra/config/global-slashrc",
        "PYTHONUNBUFFERED": "1"
    },
    "console": "integratedTerminal",
    "justMyCode": false
}
```

### WebStorm

TBD

---

## Running Slash-Tests

Here are examples for running slash-tests:

1. **Run a single test function**:
   ```bash
   slash run -k test_13_getByID tests/driveClass.py
   ```

2. **Run all tests in a file**:
   ```bash
   slash run tests/driveClass.py
   ```

3. **Run an entire suite**:
   ```bash
   slash run -f ./scale-sim-ci-suite
   ```
   
You can update debugger configuration with the according tests to run (see "test/to/run").

---

## A Note on CI Integration

These tests are not only for local debugging but are also triggered automatically as part of the **management CI pipeline** for every merge request. This guide enables you to replicate the CI behavior on your local setup (without actual scale simulator running), allowing you to debug and validate tests efficiently before pushing changes. 💪

---

## Tips 🌟

- Use `-vvv` for verbose logging to get detailed insights while debugging.
- Store logs in a temporary directory (e.g., `/tmp/infra-logs`) to keep your workspace clean.
- If you encounter issues, ensure your poetry virtual environment is active and properly configured.
- Connecting to management on localhost is currently not supported - [NVMESH-4583](https://jirasw.nvidia.com/browse/NVMESH-4583)

---

## Conclusion 😎

You're all set to debug and develop with slash-tests for the management project! Remember to keep your environment up-to-date and test thoroughly before committing your changes. Happy coding! 🎉
