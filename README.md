# RedactThat

A monorepo containing a Next.js application that automatically detects and redacts personally identifiable information (PII) from images using Google Vision API for OCR and OpenAI GPT-4o for PII detection.

## Features

- Drag & drop image upload
- Automatic PII detection using AI
- Interactive redaction controls
- Download redacted images
- Modern, responsive UI with Font Awesome Pro icons

## Getting Started

### Prerequisites

You'll need the following API keys and credentials:

1. **OpenAI API Key** - For GPT-4o PII detection
2. **Google Cloud Vision API** - For OCR text extraction

### Environment Variables

Create a `.env.local` file in the `apps/web` directory with the following variables:

```bash
# OpenAI API Key for GPT-4o
OPENAI_API_KEY=your_openai_api_key_here

# Google Cloud Vision API credentials (base64 encoded service account JSON)
GOOGLE_APPLICATION_CREDENTIALS_BASE64=your_base64_encoded_google_credentials_here
```

### Installation

1. Install dependencies:
```bash
pnpm install
```

2. Run the development server:
```bash
pnpm dev
```

3. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Project Structure

This is a Turborepo monorepo containing:

- `apps/web/` - The main Next.js application
- `packages/` - Shared packages (if any)

The development commands are managed by Turborepo and can be run from the root directory.

## How it Works

1. **Image Upload**: Users can drag & drop or browse for PNG/JPG images
2. **OCR Processing**: Google Vision API extracts text and bounding boxes from the image
3. **PII Detection**: OpenAI GPT-4o analyzes the extracted text to identify sensitive information
4. **Redaction Mapping**: PII text is mapped back to the original bounding boxes
5. **Interactive Controls**: Users can toggle redactions on/off for each detected PII
6. **Download**: Users can download the redacted image

## Tech Stack

- **Monorepo**: Turborepo
- **Framework**: Next.js 15 with App Router
- **Styling**: Tailwind CSS v4
- **UI Components**: shadcn/ui
- **Icons**: Font Awesome Pro
- **AI**: OpenAI GPT-4o via Vercel AI SDK
- **OCR**: Google Cloud Vision API
- **Type Safety**: TypeScript
- **Package Manager**: pnpm

## Learn More

To learn more about the technologies used:

- [Next.js Documentation](https://nextjs.org/docs)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)
- [Google Cloud Vision API](https://cloud.google.com/vision/docs)
- [OpenAI API](https://platform.openai.com/docs)
- [shadcn/ui](https://ui.shadcn.com/)
