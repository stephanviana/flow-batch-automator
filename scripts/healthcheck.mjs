try {
  const response = await fetch(
    `http://127.0.0.1:${process.env.PORT ?? '4319'}/health`,
    {
      signal: AbortSignal.timeout(2000),
      redirect: 'error',
    },
  );
  const health = await response.json();
  process.exitCode =
    response.ok && health.status === 'ready' && health.sqlite === 'available'
      ? 0
      : 1;
} catch {
  process.exitCode = 1;
}
