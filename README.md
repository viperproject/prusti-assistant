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

## First usage

1. Install the requirements (listed above). Restart Visual Studio Code to make sure that `rustup` is in the program path used by the IDE.
2. Install the ["Prusti Assistant" extension](https://marketplace.visualstudio.com/items?itemName=viper-admin.prusti-assistant) in Visual Studio Code.
3. Open a Rust file to activate the extension. At its first activation, this extension will automatically download Prusti and install the required Rust toolchain.

**To verify a standalone Rust program**, open the command palette (View -> Command Palette, or Shift+Ctrl+P on Ubuntu) and run the command `Prusti: verify the current file or crate`. You should see a "Running Prusti..." message in the status bar while Prusti is running. When Prusti terminates the result of the verification is reported in the status bar and in the "Problems" tab (open it with View -> Problems).

**To verify crates** instead of standalone programs, enable the corresponding flag in the settings (Preferences -> Settings -> type "Prusti" -> choose "CurrentCrate" from "verificationMode").

To automatically run Prusti when a Rust file is opened or saved, enable the corresponding flag in the settings (Preferences -> Settings -> type "Prusti" -> enable "Verify On Open" and "Verify On Save").

To update Prusti, run the command `Prusti: update verifier` in the command palette.

## Features

### Inline Code Diagnostics

This extension automatically provides inline diagnostics for Rust by running Prusti and parsing its output.

### Commands

This extension provides the following commands:

* `Prusti: verify the current file or crate` to verify a Rust program;
* `Prusti: update dependencies` to update Prusti.
* `Prusti: restart Prusti server` to restart the Prusti server used by this extension.

### Snippets

Basic code-completion snippets are provided for Prusti annotations.

### Configuration

The main configuration options used by this extension are the following:

* `prusti-assistant.verifyOnSave`: Specifies if programs should be verified on save.
* `prusti-assistant.verifyOnOpen`: Specifies if programs should be verified when opened.
* `prusti-assistant.buildChannel`: Allows to choose between the latest Prusti release version (the default) and a slightly newer but potentially unstable Prusti development version.
* `prusti-assistant.verificationMode`: Allows to choose between verifying standalone Rust programs (without crate dependencies) and crates.
