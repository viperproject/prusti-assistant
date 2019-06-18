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

* [`cargo-prusti`](http://www.pm.inf.ethz.ch/research/prusti.html) is required on your path. Alternatively, edit the `cargoPrustiPath` setting.

## Extension Settings

This extension contributes the following settings:

| Setting                             | Description                                                                | Default        |
| ----------------------------------- | -------------------------------------------------------------------------- | -------------- |
| `prusti-assistant.cargoPrustiPath`  | Specifies the path to the Cargo-Prusti binary.                             | `cargo-prusti` |
| `prusti-assistant.verifyOnSave`     | Specifies if the program should be verified on save.                       | `true`         |
| `prusti-assistant.verifyOnStartup`  | Specifies if the program should be verified on startup.                    | `true`         |
| `prusti-assistant.reportErrorsOnly` | Specifies if only error messages should be reported.                       | `true`         |

## Known Issues

If a `Cargo.toml` file is not found, the extension will not provide diagnostic data.
