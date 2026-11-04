# MacroSnap — Gemini AI + Netlify Functions

This package replaces the static-only PWA with a Netlify Functions deployment that securely calls Gemini for meal-photo estimates.

## Features
- Existing dark iPhone PWA dashboard, photo journal, custom goals and local storage
- Photo upload to `/.netlify/functions/analyze-meal`
- Gemini 2.5 Flash image analysis and JSON nutrition estimate
- Gemini API key remains server-side in Netlify environment variables
- Optional app access code protects the analysis function from casual public use

## Required Netlify environment variables
In Netlify site settings, add:
- `GEMINI_API_KEY` = your Google AI Studio API key
- `MACROSNAP_ACCESS_CODE` = choose a private code (recommended)

The user enters the same `MACROSNAP_ACCESS_CODE` in MacroSnap Settings. If you omit this variable, the function will accept requests without an access code, which is not recommended for a public URL.

## Deploy via GitHub (needed for Netlify Functions)
Netlify Drop is suitable for static files, but functions need a build/deploy workflow. Put this project in a GitHub repository and connect that repository to the existing Netlify site. Keep `netlify.toml` at the repository root and leave the functions directory as `netlify/functions`.

Netlify docs:
- https://docs.netlify.com/build/functions/get-started/
- https://docs.netlify.com/build/functions/configuration/

## Gemini
Uses `gemini-2.5-flash` via the Gemini Developer API. Free tier availability and rate limits depend on model and region and may change. Google states free-tier content may be used to improve its products. Do not upload photos containing sensitive personal information.

## Test
Once deployed and environment variables are saved:
1. Open the Netlify site.
2. Tap the gear icon.
3. Enter your chosen MacroSnap access code and save.
4. Tap Log a meal and choose/take a food photo.
5. Wait for the estimate, review values, and save.

AI nutrition estimates are approximate. Check serving sizes, ingredients, oils, sauces and condiments.
