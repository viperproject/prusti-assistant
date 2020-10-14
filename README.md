Prusti Assistant
================

[![](https://vsmarketplacebadge.apphb.com/version/viper-admin.prusti-assistant.svg)](https://marketplace.visualstudio.com/items?itemName=viper-admin.prusti-assistant)
[![Test](https://github.com/viperproject/prusti-assistant/workflows/Test/badge.svg)](https://github.com/viperproject/prusti-assistant/actions?query=workflow%3A"Test"+branch%3Amaster)

This Visual Studio Code extension provides interactive IDE features for verifying Rusti programs with the [Prusti verifier](http://prusti.ethz.ch).

## First usage

1. Install the requirements (listed in a section below). Restart Visual Studio Code to make sure that `rustup` is in the program path used by the IDE.
2. Install this [extension](https://marketplace.visualstudio.com/items?itemName=viper-admin.prusti-assistant) in Visual Studio Code.
3. Open a Rust file to activate the extension. At its first activation, this extension will automatically download Prusti.

To verify a Rust program, open the command palette (View -> Command Palette, or Shift+Ctrl+P on Ubuntu) and run the command `Prusti: save and verify this file`. You should see a "Running Prusti..." message in the status bar while Prusti is running. When Prusti terminates the result of the verification is reported in the status bar and in the "Problems" tab (open it with View -> Problems).

To automatically run Prusti when a Rust file is opened or saved, enable the corresponding flag in the settings (Preferences -> Settings -> type "Prusti" -> enable "Verify On Open" and "Verify On Save").

To update Prusti run the command `Prusti: update dependencies` in the command palette.

## Features

### Inline Code Diagnostics

This extension automatically provides inline diagnostics for Rust by running Prusti and parsing its output.

### Commands

This extension provides the following commands:

* `Prusti: save and verify this file` to verify a Rust program;
* `Prusti: update dependencies` to update Prusti.

### Snippets

Basic code-completion snippets are provided for Prusti annotations.

## Requirements

In order to use this extension, please install the following components:

* [Java Runtime Environment (or JDK), 64 bit, version 1.8 or later](https://www.java.com/en/download/)
* [Rustup](https://rustup.rs/) (on Windows this also requires the [C++ build tools for Visual Studio 2013 or later](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2019))
