// The Worker and lib import each other without extensions (bundler style); Node needs ".ts" spelled out.
import { register } from 'node:module';

if (!globalThis.__shippedResolveRegistered) {
  globalThis.__shippedResolveRegistered = true;
  register(
    'data:text/javascript,' +
      encodeURIComponent(`export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith('.') && !/\\.[a-z]+$/i.test(specifier)) return next(specifier + '.ts', context);
    throw error;
  }
}`),
  );
}
