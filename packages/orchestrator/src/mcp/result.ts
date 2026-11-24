import type { CallToolResult } from '@modelcontextprotocol/server';

export async function result(
  operation: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    return {
      content: [
        { type: 'text', text: JSON.stringify(await operation(), null, 2) },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: error instanceof Error ? error.message : 'Operação recusada.',
        },
      ],
    };
  }
}
