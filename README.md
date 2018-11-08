![Rust Assist logo](https://github.com/mooman219/rust-assist/blob/master/logo.png?raw=true)
# Rust Assist [![](https://vsmarketplacebadge.apphb.com/version/mooman219.rust-assist.svg)](https://marketplace.visualstudio.com/items?itemName=mooman219.rust-assist)

Simple VSCode diagnostic integration. Provides: code diagnostics, formatting, and snippets.

This extension is for if the RLS is causing you issues. If it is not, I recommend trying out the official [Rust VSCode Extension](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust).

## Features

### Inline Code Diagnostics

This extension automatically provides inline diagnostics for Rust by calling `cargo check` and parsing the output. As a result, it avoids using the RLS. This isn't ideal in the long term, but currently the nightly RLS _preview_ has trouble on some projects and crashes frequently.

By default, this runs on save and on startup.

### Formatting

Formatting is supported through the `rustfmt` tool. Formatting style can be configured by creating a `rustfmt.toml` file in the same directory as your `Cargo.toml` file. Possible configuration settings can be found [here](https://github.com/rust-lang-nursery/rustfmt/blob/master/Configurations.md). More information about the `rustfmt` tool can be found [here](https://github.com/rust-lang-nursery/rustfmt).

By default, formatting is not enabled.

### Supports Multiple Rust Projects

It supports multiple rust projects in the same workspace. The extension will search for `Cargo.toml` files in the workspace and use them as the root directories to generate diagnostics for.

### Snippets

Basic snippets are provided for Rust.

## Installation

### Requirements

* [`cargo`](https://github.com/rust-lang/cargo) is required on your path.
* [`rustfmt`](https://github.com/rust-lang-nursery/rustfmt) is required on your path.

### Installing `rustfmt`

Make sure you have rustup installed. Instructions for installing rustup can be found [here](https://rustup.rs/).

If you have already installed `rustfmt` via cargo, you will need to delete it from your cargo bin directory. Using `rustfmt` through cargo may break when switching toolchains or updating the compiler.

Install `rustfmt` by running:
```
rustup component add rustfmt-preview
```

## Extension Settings

This extension contributes the following settings:

| Setting                            | Description                                                                | Default     |
| ---------------------------------- | -------------------------------------------------------------------------- | ----------- |
| `rust-assist.diagnosticsOnStartup` | Specifies if diagnostics should be generated on startup.                   | `true`      |
| `rust-assist.diagnosticsOnSave`    | Specifies if diagnostics should be generated on save.                      | `true`      |
| `rust-assist.formatOnSave`         | Specifies if the file should be formatted on save.                         | `false`     |
| `rust-assist.formatMode`           | The format mode to write in. Backup generates backups, overwrite does not. | `overwrite` |

## Known Issues

If a `Cargo.toml` file is not found, the extension will not provide diagnostic data.

## Release Notes

### 0.2.3 - 2018-11-07
- Display an error when there's an configuration error in `rustfmt.toml`. 
