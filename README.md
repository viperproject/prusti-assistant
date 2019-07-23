Prusti Assistant
================

[![](https://vsmarketplacebadge.apphb.com/version/fpoli.prusti-assistant.svg)](https://marketplace.visualstudio.com/items?itemName=fpoli.prusti-assistant)
[![Build Status](https://travis-ci.org/viperproject/prusti-assistant.svg?branch=master)](https://travis-ci.org/viperproject/prusti-assistant)

VSCode plugin to verify Rust programs with the [Prusti](http://www.pm.inf.ethz.ch/research/prusti.html) verifier.

This plugin is based on a fork of [Rust Assist](https://github.com/mooman219/rust-assist).

## Features

### Inline Code Diagnostics

This extension automatically provides inline diagnostics for Rust by calling `prusti-rustc` and parsing the output.

This can automatically run when you save or open a file, if you enable the related flag in the settings.

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
* Rust's toolchain version `nightly-2018-06-27` (with the command `rustup install nightly-2018-06-27`)
* Only for Windows: [Visual C++ Build Tools 2015](https://go.microsoft.com/fwlink/?LinkId=691126)
