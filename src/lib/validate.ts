const PROJECT_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Validate a --fqdn value: a well-formed hostname that lives inside the
 * instance's zone (so devtun's DNS/custom-hostname/cert calls stay in scope).
 */
export function validateFqdn(fqdn: string, zoneDomain: string): void {
  if (!HOSTNAME_RE.test(fqdn)) {
    throw new Error(
      `Invalid --fqdn "${fqdn}". Expected a lowercase, dot-separated hostname.`
    );
  }
  if (fqdn !== zoneDomain && !fqdn.endsWith(`.${zoneDomain}`)) {
    throw new Error(
      `--fqdn ${fqdn} is not within this instance's zone (${zoneDomain}).`
    );
  }
}

export function validateProjectName(name: string): void {
  if (name.length > 63) {
    throw new Error(
      `Project name too long (${name.length} chars, max 63). DNS labels must be 63 characters or fewer.`
    );
  }
  if (!PROJECT_NAME_RE.test(name)) {
    throw new Error(
      `Invalid project name "${name}". Use only lowercase letters, numbers, and hyphens. Must start and end with a letter or number.`
    );
  }
}
