Prusti Assistant
================

[![](https://vsmarketplacebadge.apphb.com/version/fpoli.prusti-assistant.svg)](https://marketplace.visualstudio.com/items?itemName=fpoli.prusti-assistant)
[![Build Status](https://travis-ci.org/viperproject/prusti-assistant.svg?branch=master)](https://travis-ci.org/viperproject/prusti-assistant)

VSCode plugin to verify Rust programs with the [Prusti](http://www.pm.inf.ethz.ch/research/prusti.html) verifier.

This plugin is based on a fork of [Rust Assist](https://github.com/mooman219/rust-assist).

## Features

### Inline Code Diagnostics

This extension automatically provides inline diagnostics for Rust by calling `prusti-rustc` and parsing the output.

This can automatically run on save and on startup. See the related flag in the settings.

### Snippets

Basic code-completion snippets are provided for Prusti annotations.

## Requirements

* [Visual C++ Build Tools 2015](https://go.microsoft.com/fwlink/?LinkId=691126)
* [Java Runtime Environment, 64 bit](https://www.java.com/en/download/)
* [Rustup](https://rustup.rs/)
* [Prusti](http://www.pm.inf.ethz.ch/research/prusti.html)
* [Viper](http://viper.ethz.ch/downloads/)
* Configure the paths in this plugin's settings
