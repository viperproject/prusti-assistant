Prusti Assistant
================

[![](https://vsmarketplacebadge.apphb.com/version/viper-admin.prusti-assistant.svg)](https://marketplace.visualstudio.com/items?itemName=viper-admin.prusti-assistant)
[![](https://img.shields.io/open-vsx/v/viper-admin/prusti-assistant?label=Open%20VSX)](https://open-vsx.org/extension/viper-admin/prusti-assistant)
[![Test and publish](https://github.com/viperproject/prusti-assistant/workflows/Test%20and%20publish/badge.svg)](https://github.com/viperproject/prusti-assistant/actions?query=workflow%3A"Test+and+publish"+branch%3Amaster)
[![Test coverage](https://codecov.io/gh/viperproject/prusti-assistant/branch/master/graph/badge.svg?token=D4HOAD0KRU)](https://codecov.io/gh/viperproject/prusti-assistant)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=viperproject_prusti-assistant&metric=alert_status)](https://sonarcloud.io/dashboard?id=viperproject_prusti-assistant)

This Visual Studio Code extension provides interactive IDE features for verifying Rusti programs with the [Prusti verifier](https://github.com/viperproject/prusti-dev).

For advanced use cases, consider switching to the [command-line version of Prusti](https://github.com/viperproject/prusti-dev).

## Requirements

In order to use this extension, please install the following components:

* Java JDK version 11 or later, 64 bit. We recommend [OpenJDK 15.0.1](https://jdk.java.net/15/).
* [Rustup version 1.23.0 or later](https://rustup.rs/). On Windows, this in turn requires the [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).

If something fails, check the "Troubleshooting" section below.

## First Usage

1. Install the requirements (listed above) and restart the IDE.
   * This will ensure that programs like `rustup` are in the program path used by the IDE.
2. Install the ["Prusti Assistant"](https://marketplace.visualstudio.com/items?itemName=viper-admin.prusti-assistant) extension.
3. Open a Rust file to activate the extension.
   * At its first activation, this extension will automatically download Prusti and install the required Rust toolchain.
4. Click on the "Verify with Prusti" button in the status bar.
   * Alternativelly, you can run the `Prusti: verify the current crate or file` command.
   * If the program is in a folder with a `Cargo.toml` file, Prusti will verify the crate in which the file is contained.
   * If no `Cargo.toml` file can be found in a parent folder of the workspace, Prusti will verify the file as a standalone Rust program. No Cargo dependencies are allowed in this mode.
5. Follow the progress from the status bar.
   * You should see a "Verifying crate [folder name]" or "Verifying file [name]" message while Prusti is running.
6. The result of the verification is reported in the status bar and in the "Problems" tab.
   * You can open the "Problems" tab by clicking on Prusti's status bar.
   * Be aware that the "Problems" tab is shared by all extensions. If you are not sure which extension generated which error, try disabling other extensions. (Related VS Code issue: [#51103](https://github.com/microsoft/vscode/issues/51103).)

To update Prusti, run the command `Prusti: update verifier` in the command palette.

If something fails, check the "Troubleshooting" section below.

## Features

### Commands

This extension provides the following commands:

* `Prusti: verify the current crate or file` to verify a Rust program;
* `Prusti: update verifier` to update Prusti.
* `Prusti: show version` to show the version of Prusti.
* `Prusti: restart Prusti server` to restart the Prusti server used by this extension.

### Configuration

The main configuration options used by this extension are the following:

* `prusti-assistant.verifyOnSave`: Specifies if programs should be verified on save.
* `prusti-assistant.verifyOnOpen`: Specifies if programs should be verified when opened.
* `prusti-assistant.buildChannel`: Allows to choose between the latest Prusti release version (the default) and a slightly newer but potentially unstable Prusti development version.
* `prusti-assistant.checkForUpdates`: Specifies if Prusti should check for updates at startup.
* `prusti-assistant.javaHome`: Specifies the path of the Java home folder (leave empty to auto-detect).

### Inline Code Diagnostics

This extension automatically provides inline diagnostics for Prusti errors.

### Snippets

Basic code-completion snippets are provided for Prusti annotations.

## Troubleshooting

If Prusti fails to run, you can inspect Prusti's log from VS Code (View -> Output -> Prusti Assistant) and see if one of the following solutions applies to you.

| Problem | Solution |
|---------|----------|
| On Windows, Visual Studio is installed but the `rustup` installer still complains that the Microsoft C++ build tools are missing. | When asked which workloads to install in Visual Studio make sure "C++ build tools" is selected and that the Windows 10 SDK and the English language pack components are included. If the problem persists, check [this Microsoft guide](https://docs.microsoft.com/en-us/windows/dev-environment/rust/setup) and [this Rust guide](https://doc.rust-lang.org/book/ch01-01-installation.html#installing-rustup-on-windows). Then, restart the IDE. |
| The JVM is installed, but the extension cannot auto-detect it. | Open the settings of the IDE, search for "Prusti-assistant: Java Home" and manually set the path of the Java home folder. Alternatively, make sure that the `JAVA_HOME` environment variable is set in your OS. Then, restart the IDE. |
| Prusti crashes mentioning "Unexpected output of Z3" in the log. | Prusti is using an incompatible Z3 version. Make sure that the `Z3_EXE` environment variable is unset in your OS. Then, restart the IDE. |
| `error[E0514]: found crate 'cfg_if' compiled by an incompatible version of rustc` | There is a conflict between Prusti and a previous Cargo compilation. Run `cargo clean` or manually delete the `target` folder. Then, rerun Prusti. |
| `error: the 'cargo' binary, normally provided by the 'cargo' component, is not applicable to the 'nightly-2021-09-20-x86_64-unknown-linux-gnu' toolchain` <br/> or <br/> `error[E0463]: can't find crate for std` <br/> or <br/> `error[E0463]: can't find crate for core` | The Rust toolchain installed by Rustup is probably corrupted (see issue [rustup/#2417](https://github.com/rust-lang/rustup/issues/2417)). [Uninstall](https://stackoverflow.com/questions/42322879/how-to-remove-rust-compiler-toolchains-with-rustup) the nightly toolchain mentioned in the error (or all installed nightly toolchains). Then, rerun Prusti. |

Thanks to @Pointerbender for reporting issues and suggesting solutions!
