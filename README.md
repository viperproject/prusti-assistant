# Rust Assist README

Simple VSCode diagnostic integration.

This extension is for if the RLS is causing you issues. If it is not, I recommend trying out the official [Rust VSCode Extension](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust).

## Features

### Inline Diagnostics

This extension automatically provides inline diagnostics for rust by calling `cargo check` and parsing the output. As a result, it avoids using the RLS. This isn't ideal in the long term, but currently the nightly RLS _preview_ has trouble on some projects and crashes frequently.

### Multiple Rust Projects

It supports multiple rust projects in the same workspace. The extension will search for `Cargo.toml` files in the workspace and use them as the root directories to generate diagnostics for.

## Requirements

* Cargo is required on your path.

## Extension Settings

This extension contributes the following settings:

* `rust-assist.checkOnStartup`: Enable generating diagnostic on startup.
* `rust-assist.checkOnSave`: Enable generating diagnostic data on save.

## Known Issues

If a `Cargo.toml` file is not found, the extension will not provide diagnostic data.

## Release Notes

### 0.1.2 - 2018-05-23
- Fix issue with warnings not being reissued for lib projects
- Update the logo
