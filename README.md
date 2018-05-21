# rust-assist README

Very simple diagnostic integration with `cargo check`.

## Features

This extension provides inline diagnostics for rust by calling `cargo check` and parsing the output. As a result, it avoids using the RLS. This isn't ideal in the long run, but currently the nightly RLS has trouble on some projects and crashes frequently.

## Requirements

* Cargo is required.
* The root directory of the VSCode workspace must be a valid rust project to run `cargo check` in.

## Extension Settings

This extension contributes the following settings:

* `rust-assist.checkOnStartup`: Enable running `cargo check` on extension startup.
* `rust-assist.checkOnSave`: Enable running `cargo check` on save.

## Known Issues

If the `vscode.workspace.rootPath` is undefined, the extension cannot run. Additionally, this extension only works when `cargo check` can be run in the root directory.

## Release Notes

### 0.1.0

Initial release.