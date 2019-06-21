Prusti Assistant
================

VSCode plugin to verify Rust crates with the [Prusti](http://www.pm.inf.ethz.ch/research/prusti.html) verifier.

This plugin is based on a fork of [Rust Assist](https://github.com/mooman219/rust-assist).

## Features

### Inline Code Diagnostics

This extension automatically provides inline diagnostics for Rust by calling `cargo-prusti` and parsing the output.

By default, this runs on save and on startup.

### Supports Multiple Rust Projects

It supports multiple rust projects in the same workspace. The extension will search for `Cargo.toml` files in the workspace and use them as the root directories to generate diagnostics for.

### Snippets

Basic code-completion snippets are provided for Prusti annotations.

## Requirements

* [Visual C++ Build Tools 2015](https://go.microsoft.com/fwlink/?LinkId=691126)
* [Rustup](https://rustup.rs/)
* [Java Runtime Environment, 64 bit](https://www.java.com/en/download/)
* [Prusti](http://www.pm.inf.ethz.ch/research/prusti.html)
* [Viper](http://viper.ethz.ch/downloads/)
* Configure the paths in the settings

## Known Issues

If a `Cargo.toml` file is not found, the extension will not provide diagnostic data.
