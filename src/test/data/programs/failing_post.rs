use prusti_contracts::*;

#[pure]
fn something_true() -> bool {
    true
}

#[allow(dead_code)]
#[allow(unused_variables)]
#[ensures(something_true() && false)]
fn client(a: u32) {}

#[allow(dead_code)]
fn main() {}
