# rust-assist README

Very simple diagnostic integration with `cargo check`.

## Features

This extension provides inline diagnostics for rust by calling `cargo check` and parsing the output. As a result, it avoids using the RLS. This isn't ideal in the long term, but currently the nightly RLS _preview_ has trouble on some projects and crashes frequently.

It supports multiple rust projects in the same workspace.

## Requirements

* Cargo is required on your path.

## Extension Settings

This extension contributes the following settings:

* `rust-assist.checkOnStartup`: Enable running `cargo check` on extension startup.
* `rust-assist.checkOnSave`: Enable running `cargo check` on save.

## Known Issues

The extension will search for `Cargo.toml` files in the workspace and use them as the root directories to run `cargo check` in. If none are found, the extension will fall back to `vscode.workspace.rootPath` as the directory to run `cargo check` in.

## Release Notes

### 0.1.1 - 2018-05-22
- Update the logo
