const PROJECT_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

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
