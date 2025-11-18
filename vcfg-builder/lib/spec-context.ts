export function createSpecContextFactory() {
  let counter = 0;
  return () => {
    const id = `spec${counter}`;
    counter += 1;
    return id;
  };
}
