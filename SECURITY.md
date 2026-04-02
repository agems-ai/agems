# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| Latest (main branch) | Yes |
| All previous versions | No |

We only provide security fixes for the latest version on the `main` branch.
Users are encouraged to always run the most recent release.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report vulnerabilities privately by emailing **max@agems.ai**.

### What to Include

- A clear description of the vulnerability
- Steps to reproduce the issue
- Affected components (API endpoint, web interface, Docker configuration, etc.)
- Potential impact and severity assessment
- Any suggested fixes, if available

### Response Timeline

- **Acknowledgment**: Within 48 hours of receiving the report
- **Initial assessment**: Within 5 business days
- **Critical fixes**: Within 7 days of confirmation
- **Non-critical fixes**: Included in the next scheduled release

We will keep you informed of progress throughout the process.

## Scope

### In Scope

- AGEMS API server and endpoints
- Web application (frontend and backend)
- Docker and container configuration
- Authentication and authorization mechanisms
- Data handling and storage

### Out of Scope

- Third-party dependencies (report these to the respective maintainers)
- Issues in upstream frameworks or libraries
- Attacks requiring physical access to the server
- Social engineering attacks
- Denial of service attacks

## Disclosure Policy

We follow a coordinated disclosure process. We ask that reporters:

1. Allow us reasonable time to address the issue before public disclosure
2. Avoid accessing or modifying other users' data
3. Act in good faith to avoid disruption to the service

We credit reporters in release notes unless they prefer to remain anonymous.

## Contact

Email: max@agems.ai
