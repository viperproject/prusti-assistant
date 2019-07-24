Prusti Assistant
================

[![](https://vsmarketplacebadge.apphb.com/version/fpoli.prusti-assistant.svg)](https://marketplace.visualstudio.com/items?itemName=fpoli.prusti-assistant)
[![Build Status](https://travis-ci.org/viperproject/prusti-assistant.svg?branch=master)](https://travis-ci.org/viperproject/prusti-assistant)

VSCode plugin to verify Rust programs with the [Prusti](http://www.pm.inf.ethz.ch/research/prusti.html) verifier.

This plugin is based on a fork of [Rust Assist](https://github.com/mooman219/rust-assist).

## First usage

1. Install the requirements (listed in a section below). Restart Visual Studio Code to make sure that the IDE has `rustup` in the program path.
2. Install this extension in Visual Studio Code.
3. Open a Rust file to activate the extension. At its first activation, this extension will automatically download the required Prusti binaries.

To verify a Rust program, open the command palette (View -> Command Palette, or Shift+Ctrl+P on Ubuntu) and run the command `Prusti: verify this file`. You should see a "Running Prusti..." message in the status bar while Prusti is running. When Prusti terminates the result of the verification is reported in the status bar and in the "Problems" tab (open it with View -> Problems).

To automatically run Prusti when a Rust file is opened or saved, enable the corresponding flag in the settings (Preferences -> Settings -> type "Prusti" -> enable "Verify On Open" and "Verify On Save").

To update the Prusti binaries run the command `Prusti: install or update dependencies` in the command palette.

## Features

### Inline Code Diagnostics

This extension automatically provides inline diagnostics for Rust by running Prusti and parsing its output.

### Commands

This extension provides the following commands:

* `Prusti: verify this file` to verify a Rust program;
* `Prusti: install or update dependencies` to update Prusti.

### Snippets

Basic code-completion snippets are provided for Prusti annotations.

## Requirements

In order to use this extension, please install the following components:

* [Java Runtime Environment (or JDK), 64 bit](https://www.java.com/en/download/)
* [Rustup](https://rustup.rs/)
* Rust's toolchain version `nightly-2018-06-27`, which can be installed with the command `rustup install nightly-2018-06-27`
* Only for Windows: [Visual C++ Build Tools 2015](https://go.microsoft.com/fwlink/?LinkId=691126)
