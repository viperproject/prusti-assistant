Prusti Assistant
================

[![](https://vsmarketplacebadge.apphb.com/version/viper-admin.prusti-assistant.svg)](https://marketplace.visualstudio.com/items?itemName=viper-admin.prusti-assistant)
[![](https://img.shields.io/open-vsx/v/viper-admin/prusti-assistant?label=Open%20VSX)](https://open-vsx.org/extension/viper-admin/prusti-assistant)
[![Test and publish](https://github.com/viperproject/prusti-assistant/workflows/Test%20and%20publish/badge.svg)](https://github.com/viperproject/prusti-assistant/actions?query=workflow%3A"Test+and+publish"+branch%3Amaster)
[![Test coverage](https://codecov.io/gh/viperproject/prusti-assistant/branch/master/graph/badge.svg?token=D4HOAD0KRU)](https://codecov.io/gh/viperproject/prusti-assistant)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=viperproject_prusti-assistant&metric=alert_status)](https://sonarcloud.io/dashboard?id=viperproject_prusti-assistant)

This Visual Studio Code extension provides interactive IDE features for verifying Rusti programs with the [Prusti verifier](https://github.com/viperproject/prusti-dev).

## Requirements

In order to use this extension, please install the following components:

* Java JDK version 11 or later, 64 bit. We recommend [OpenJDK 15.0.1](https://jdk.java.net/15/).
* [Rustup version 1.23.0 or later](https://rustup.rs/) (on Windows this also requires the [C++ build tools for Visual Studio 2013 or later](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2019)).

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

## Features

### Commands

This extension provides the following commands:

* `Prusti: verify the current crate or file` to verify a Rust program;
* `Prusti: update verifier` to update Prusti.
* `Prusti: restart Prusti server` to restart the Prusti server used by this extension.

### Configuration

The main configuration options used by this extension are the following:

* `prusti-assistant.verifyOnSave`: Specifies if programs should be verified on save.
* `prusti-assistant.verifyOnOpen`: Specifies if programs should be verified when opened.
* `prusti-assistant.buildChannel`: Allows to choose between the latest Prusti release version (the default) and a slightly newer but potentially unstable Prusti development version.

### Inline Code Diagnostics

This extension automatically provides inline diagnostics for Prusti errors.

### Snippets

Basic code-completion snippets are provided for Prusti annotations.

## Troubleshooting

### Incompatible version of rustc

If after an upgrade you get the error "found crate `[name]` compiled by an incompatible version of rustc" while verifying a crate, run `cargo clean` or manually delete the `target` folder. Then, rerun Prusti.
