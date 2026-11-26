# Security policy

## Reporting a vulnerability

Please report a vulnerability privately, through GitHub's private vulnerability reporting: open the
repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue or a pull
request for it.

Say what you found, how to reproduce it, and which version of Pattern Dump it affects. You will get an answer
as soon as the maintainer can give one; a fix is released as a new version, and the report is made public with
it.

## Supported versions

Pattern Dump is at 0.x: it is complete enough to use, and breaking changes are still possible between minor
versions. Only the latest release gets security fixes.

## What counts

Pattern Dump runs code by design: your project's config, its Handlebars helpers and scripts, and the helpers and
scripts of the pattern packages you install. Running them is what you asked for, so anything that needs you to run
code you installed or wrote is out of scope.

In scope is what untrusted content can make Pattern Dump do: the markdown, frontmatter, JSON data, images and file
names of a project or a package, such as a page someone sends you or a package's content. These count:

- Content that makes `pd dev`, `pd build`, `pd audit` or another command read or write a file outside the project.
- Content that ends up as script in the workbench or in a built page.
- `pd dev`, the workbench or the MCP server answering anyone beyond the loopback address, or serving a file from
  outside the project. The folders the config names are the project's here: its pattern packages and its
  `site.mounts`.
- The Chromium step that renders social images loading anything it shouldn't: another host, or a file outside the
  project.
