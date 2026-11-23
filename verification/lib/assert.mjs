// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors
//
// The expectations. A journey step says what must be true; this file
// decides whether it is.

/**
 * Checks one value against the expectation of a step.
 *
 * An expectation is an object with one or more of these keys:
 *   equals      the value must be exactly this
 *   notEquals   the value must not be this
 *   contains    a string must contain this text
 *   notContains a string must not contain this text
 *   matches     a string must match this regular expression
 *   truthy      the value must be truthy
 *   falsy       the value must be falsy
 *   above       a number must be greater than this
 *   atLeast     a number must be greater than or equal to this
 */
export function check(value, expectation, description) {
  const problems = [];
  const has = (key) => Object.prototype.hasOwnProperty.call(expectation, key);

  if (has("equals") && value !== expectation.equals) {
    problems.push(`expected ${JSON.stringify(expectation.equals)} but got ${JSON.stringify(value)}`);
  }
  if (has("notEquals") && value === expectation.notEquals) {
    problems.push(`expected anything but ${JSON.stringify(expectation.notEquals)}`);
  }
  if (has("contains") && !String(value).includes(expectation.contains)) {
    problems.push(`expected ${JSON.stringify(value)} to contain ${JSON.stringify(expectation.contains)}`);
  }
  if (has("notContains") && String(value).includes(expectation.notContains)) {
    problems.push(`expected ${JSON.stringify(value)} not to contain ${JSON.stringify(expectation.notContains)}`);
  }
  if (has("matches") && !new RegExp(expectation.matches).test(String(value))) {
    problems.push(`expected ${JSON.stringify(value)} to match ${JSON.stringify(expectation.matches)}`);
  }
  if (has("truthy") && !value) {
    problems.push(`expected a truthy value but got ${JSON.stringify(value)}`);
  }
  if (has("falsy") && value) {
    problems.push(`expected a falsy value but got ${JSON.stringify(value)}`);
  }
  if (has("above") && !(Number(value) > expectation.above)) {
    problems.push(`expected a number above ${expectation.above} but got ${JSON.stringify(value)}`);
  }
  if (has("atLeast") && !(Number(value) >= expectation.atLeast)) {
    problems.push(`expected a number of at least ${expectation.atLeast} but got ${JSON.stringify(value)}`);
  }

  if (problems.length) {
    throw new Error(`${description}: ${problems.join("; ")}`);
  }
  return value;
}
