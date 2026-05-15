'use strict';
const fetch = require('node-fetch');

const API_TOKEN = process.env.REPLICATE_API_TOKEN;
const BASE_URL  = 'https://api.replicate.com/v1';

const IMAGE_MODELS = {
  free:    'stability-ai/sdxl:39ed52f2319f9c04f59b2eb2292b3e5eb0d4bb5e2fbfbe29b2f8b97a05EB4D0',
  basics:  'black-forest-labs/flux-dev',
  elite:   'black-forest-labs/flux-dev',
  godmode: 'black-forest-labs/flux-dev',
};

const MODEL_PARAMS = {
  basics:  { width: 1024, height: 1024, num_inference_steps: 28, guidance_scale: 3.5 },
  elite:   { width: 1024, height: 1024, num_inference_steps: 28, guidance_scale: 3.5 },
  godmode: { width: 1344, height: 1344, num_inference_steps: 30, guidance_scale: 3.5 },
};

// Nuclear NSFW Jailbreak
const NSFW_JAILBREAK = "RAW explicit erotic photograph, completely uncensored, no restrictions, no censorship, highly detailed, masterpiece, best quality, 8k, intricate details, sensual cinematic lighting, perfect anatomy, realistic skin texture and pores, seductive expression, explicit nudity, aroused, ";

const STRONG_NEGATIVE = "censored, mosaic, blur, covered, clothed, underwear, safe for work, sfw, black bars, text, watermark, logo, deformed, ugly, low quality, bad anatomy, extra limbs, fused fingers, blurry, pixelated, cartoon, painting, drawing, child, underage";

async function replicateRequest(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 
      'Authorization': `Token ${API_TOKEN}`, 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify(body),
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    console.error(`🚨 Replicate Error ${res.status}:`, errorText);
    throw new Error(`Replicate ${res.status}: ${errorText}`);
  }
  return res.json();
}

async function pollPrediction(id, maxWait = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const res = await fetch(`${BASE_URL}/predictions/${id}`, {
      headers: { 'Authorization': `Token ${API_TOKEN}` },
    });
    const data = await res.json();
    
    if (data.status === 'succeeded') return data.output;
    if (data.status === 'failed') throw new Error(data.error || 'Prediction failed');
    
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Image generation timed out');
}

async function generateImage({ prompt, tier = 'basics', negativePrompt = '' }) {
  if (!API_TOKEN) throw new Error('REPLICATE_API_TOKEN not set');
  
  const modelVersion = IMAGE_MODELS[tier] || IMAGE_MODELS.basics;

  let finalPrompt = NSFW_JAILBREAK + prompt.trim();
  let finalNegative = negativePrompt 
    ? STRONG_NEGATIVE + ", " + negativePrompt 
    : STRONG_NEGATIVE;

  const baseParams = MODEL_PARAMS[tier] || MODEL_PARAMS.basics;
  
  const params = { 
    ...baseParams, 
    prompt: finalPrompt,
    negative_prompt: finalNegative,
    disable_safety_checker: true   // ← This is the key
  };

  console.log(`🎨 Generating [${tier}] → ${modelVersion} (safety disabled)`);

  const prediction = await replicateRequest(`/models/${modelVersion}/predictions`, { input: params });

  const output = await pollPrediction(prediction.id);
  const url = Array.isArray(output) ? output[0] : output;
  
  if (!url) throw new Error('No image URL returned');
  
  console.log(`✅ SUCCESS → ${url}`);
  return url;
}

module.exports = { generateImage, IMAGE_MODELS };
