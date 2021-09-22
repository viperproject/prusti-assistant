use prusti_contracts::*;

#[requires(x > 123)]
fn test(x: i32) {
    assert!(x > 123);
}

fn main() {
    test(1);
}
