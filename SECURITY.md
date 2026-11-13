# Security policy

## Reporting a vulnerability

Please report a vulnerability privately, through GitHub's private vulnerability reporting: open the
repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue or a pull
request for it.

Say what you found, how to reproduce it, and which version of Pattern Dump it affects. You will get an answer
as soon as the maintainer can give one; a fix is released as a new version, and the report is made public with
it.

## Supported versions

Pattern Dump is in alpha. Only the latest release gets security fixes.

## What counts

Pattern Dump runs on your machine, over your own project. Reports about what a malicious project, package or
page could make `pd dev`, `pd build` or `pd audit` do (read or write files outside the project, run code the
project did not ask for, reach beyond the loopback address) are in scope. Problems that need an attacker who
already controls your machine or your project's own code are not.
