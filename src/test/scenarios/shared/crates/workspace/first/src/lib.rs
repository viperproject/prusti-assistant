use prusti_contracts::*;

#[requires(dividend != 0)]
pub fn divide_by(divisor: usize, dividend: usize) -> usize {
    divisor / dividend
}

pub fn generate_error() {
    assert!(false)
}
