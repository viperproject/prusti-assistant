# Test cases


## Structure

The structure of this folder is:

* `vscode-version` — The vscode version to use to run the tests.
* `<scenario_case>/settings.json` — The settings of a scenario.
* `<scenario_case>/programs/<program_name>.rs` — A standalone program test case of the scenario.
* `<scenario_case>/programs/<program_name>.rs.json` — The expected diagnostics of a test case.
* `<scenario_case>/crates/<crate_name>/...` — A crate test case of the scenario.
    * Each `.rs` file is expected to have a corresponding `.rs.json` file containing the expected diagnostics.

The special "shared" scenario does not contain `settings.json` and implicitly part of all other scenarios.

## Expected diagnostics

The content of the `.rs.json` expected diagnostics can be either:

* A list of expected diagnostics, like `[{"message": "[Prusti: verification error] ...", "range": { ... }, ...}, ...]`
* A list of alternatives, each as a dictionary with an `"filter"` and a `"diagnostics"` key. The the first alternative whose filter is satisfied is used as expected diagnostics.
    * `"filter"` is a dictionary with a "os" key. This key is optional.
    * `"diagnostics"` is a list of diagnostics. This key is mandatory.
