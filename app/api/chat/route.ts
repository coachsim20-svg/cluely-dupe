import { openai } from '@ai-sdk/openai';
import { streamText, convertToModelMessages } from 'ai';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    // Check if API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not set in environment variables');
      return new Response(
        JSON.stringify({ error: 'OpenAI API key is not configured. Please add OPENAI_API_KEY to your .env.local file.' }), 
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { messages } = await req.json();

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Messages are required' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating AI response for messages:', messages.length, 'messages');

    const result = streamText({
      model: openai('gpt-5-nano-2025-08-07'),
      providerOptions: {
        openai: {
          reasoningEffort: 'minimal',
        },
      },
      messages: convertToModelMessages(messages),
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error('Error in chat API:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: `Failed to generate response: ${errorMessage}` }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

