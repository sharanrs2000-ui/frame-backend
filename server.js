// ================================
// Reframe V1 - Backend Server
// ================================

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// Root check
app.get("/", (req, res) => {
  res.json({ status: "Reframe backend is running" });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ================================
// OpenAI Configuration
// ================================

if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing");
}

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Load model examples
const modelExamples = require('./model-examples.json');

// ================================
// Middleware
// ================================

const allowedOrigins = [
    'https://reframe.co.in',
    'https://www.reframe.co.in',
    'https://frame-frontend-beta.vercel.app',
    'http://localhost:8080'
];

app.use(cors({
    origin: function (origin, callback) {
        // allow requests with no origin (like curl, health checks)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error('CORS not allowed for this origin'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'reframe-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// ================================
// Authentication Setup
// ================================

// In-memory user storage (replace with database in production)
const users = new Map();
const savedPrompts = new Map();

// Only configure Google OAuth if credentials are provided
const oauthConfigured = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET;

if (oauthConfigured) {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback'
    }, (accessToken, refreshToken, profile, done) => {
        const user = {
            id: profile.id,
            name: profile.displayName,
            email: profile.emails[0].value,
            avatar: profile.photos[0].value
        };

        users.set(profile.id, user);
        return done(null, user);
    }));
}

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    const user = users.get(id);
    done(null, user);
});

// ================================
// Model-Specific Prompt Structures
// ================================

const MODEL_TEMPLATES = {
    chatgpt: {
        systemPrompt: `You are a prompt restructuring engine for ChatGPT/OpenAI models.

Rules:
1. Output ONLY the restructured prompt. No explanations, preambles, or meta-commentary.
2. Preserve user intent exactly. Do not add features, remove constraints, or change meaning.
3. Apply ChatGPT-specific formatting by following the example structure provided below.
4. If clarifications provided, integrate them seamlessly.
5. Do not execute the prompt. Do not provide answers. Only restructure.
6. NEVER mention model version numbers (like "GPT-4", "GPT-5", "ChatGPT-4o", etc.) in the restructured prompt. Simply write for the latest ChatGPT capabilities without version references.

EXAMPLE STRUCTURE FOR CHATGPT PROMPTS:
${modelExamples.chatgpt.example}

Your task:
- Analyze the example structure above (note the use of Jupyter notebook style, markdown sections, XML-style tags like <output_verbosity_spec>, detailed enterprise patterns)
- Apply similar structural patterns to restructure the user's prompt
- Maintain the same level of detail, organization, and formatting style
- Use appropriate sections like verbosity control, scope constraints, tool usage, long-context handling, etc. when relevant
- Keep the user's original intent but present it in ChatGPT's preferred format
- Write for the latest model capabilities without mentioning any version numbers`
    },

    claude: {
        systemPrompt: `You are a prompt restructuring engine for Claude AI.

Rules:
1. Output ONLY the restructured prompt. No explanations, preambles, or meta-commentary.
2. Preserve user intent exactly. Do not add features, remove constraints, or change meaning.
3. Apply Claude-specific formatting by following the example structure provided below.
4. If clarifications provided, integrate them seamlessly.
5. Do not execute the prompt. Do not provide answers. Only restructure.
6. NEVER mention model version numbers (like "Claude 3", "Claude 3.5", "Sonnet", etc.) in the restructured prompt. Simply write for the latest Claude capabilities without version references.

EXAMPLE STRUCTURE FOR CLAUDE PROMPTS:
${modelExamples.claude.example}

Your task:
- Analyze the example structure above (note the use of XML-style tags like <critical_injection_defense>, <behavior_instructions>, <tone_and_formatting>, hierarchical organization)
- Apply similar structural patterns to restructure the user's prompt
- Maintain the same level of detail, organization, and formatting style
- Use XML tags to organize different sections (goals, rules, constraints, etc.)
- Include relevant sections for security, behavior, tone, and action types when applicable
- Keep the user's original intent but present it in Claude's preferred format
- Write for the latest model capabilities without mentioning any version numbers`
    },

    gemini: {
        systemPrompt: `You are a prompt restructuring engine for Gemini AI.

Rules:
1. Output ONLY the restructured prompt. No explanations, preambles, or meta-commentary.
2. Preserve user intent exactly. Do not add features, remove constraints, or change meaning.
3. Apply Gemini-specific formatting by following the example structure provided below.
4. If clarifications provided, integrate them seamlessly.
5. Do not execute the prompt. Do not provide answers. Only restructure.
6. NEVER mention model version numbers (like "Gemini 2.0", "Gemini 2.5", "Flash", "Pro", etc.) in the restructured prompt. Simply write for the latest Gemini capabilities without version references.

EXAMPLE STRUCTURE FOR GEMINI PROMPTS:
${modelExamples.gemini.example}

Your task:
- Analyze the example structure above (note the use of markdown headers ##, code examples, detailed technical specifications, React/TypeScript patterns if coding-related)
- Apply similar structural patterns to restructure the user's prompt
- Maintain the same level of detail, organization, and formatting style
- Use markdown headers for clear section organization
- Include code examples and technical guidelines when relevant
- For coding tasks, structure with sections like Runtime, Project Structure, Syntax Rules, API guidance
- Keep the user's original intent but present it in Gemini's preferred format
- Write for the latest model capabilities without mentioning any version numbers`
    },

    perplexity: {
        systemPrompt: `You are a prompt restructuring engine for Perplexity AI.

Rules:
1. Output ONLY the restructured prompt. No explanations, preambles, or meta-commentary.
2. Preserve user intent exactly. Do not add features, remove constraints, or change meaning.
3. Apply Perplexity-specific formatting by following the example structure provided below.
4. If clarifications provided, integrate them seamlessly.
5. Do not execute the prompt. Do not provide answers. Only restructure.
6. NEVER mention model version numbers (like "Sonar", "Pro", etc.) in the restructured prompt. Simply write for the latest Perplexity capabilities without version references.

EXAMPLE STRUCTURE FOR PERPLEXITY PROMPTS:
${modelExamples.perplexity.example}

Your task:
- Analyze the example structure above (note the use of XML tags like <goal>, <format_rules>, <restrictions>, <query_type>, emphasis on citations and search-grounded answers)
- Apply similar structural patterns to restructure the user's prompt
- Maintain the same level of detail, organization, and formatting style
- Include sections for goal definition, formatting rules, citation requirements, and query type handling
- Emphasize search grounding, journalistic tone, and proper citation practices
- Use XML tags to organize different instruction categories
- Keep the user's original intent but present it in Perplexity's preferred format
- Write for the latest model capabilities without mentioning any version numbers`
    },

    others: {
        systemPrompt: `You are a prompt restructuring engine for general AI models.

Rules:
1. Output ONLY the restructured prompt. No explanations, preambles, or meta-commentary.
2. Preserve user intent exactly. Do not add features, remove constraints, or change meaning.
3. Apply universal best practices by following the example structure provided below.
4. If clarifications provided, integrate them seamlessly.
5. Do not execute the prompt. Do not provide answers. Only restructure.

EXAMPLE STRUCTURE FOR GENERAL AI PROMPTS:
${modelExamples.others.example}

Your task:
- Analyze the example structure above (note the simple, clear organization with Task, Input, Requirements, Output sections)
- Apply similar structural patterns to restructure the user's prompt
- Maintain the same level of clarity and simplicity
- Use clear section headers
- Organize with: Task description, Input/Context, Requirements/Constraints, Expected Output format
- Keep the user's original intent but present it in a clear, universally compatible format`
    }
};

// ================================
// Ambiguity Detection Logic
// ================================

function detectAmbiguity(prompt) {
    const ambiguities = [];

    // Check for vague quantifiers
    const vagueQuantifiers = /\b(some|few|many|several|a bit|lots of)\b/gi;
    if (vagueQuantifiers.test(prompt)) {
        ambiguities.push({
            type: 'vague_quantifier',
            question: 'How many examples or items would you like?',
            options: ['1-2', '3-5', '5-10', 'More than 10']
        });
    }

    // Check for undefined scope
    const broadTopics = /\b(explain|describe|tell me about)\s+(?!how|why|when|where)\w+/i;
    if (broadTopics.test(prompt) && prompt.length < 50) {
        ambiguities.push({
            type: 'undefined_scope',
            question: 'What level of detail do you need?',
            options: ['Brief overview', 'Moderate detail', 'In-depth explanation']
        });
    }

    // Check for missing output format
    const formatKeywords = /\b(list|table|summary|paragraph|code|json|steps)\b/i;
    if (!formatKeywords.test(prompt) && prompt.split(' ').length > 10) {
        ambiguities.push({
            type: 'missing_format',
            question: 'How should the output be formatted?',
            options: ['Bullet points', 'Paragraph', 'Step-by-step', 'Table']
        });
    }

    // Return max 3 questions
    return {
        hasAmbiguity: ambiguities.length > 0,
        questions: ambiguities.slice(0, 3)
    };
}

// ================================
// Model-Specific JSON Formatters
// ================================

function formatForModel(model, restructuredPrompt, originalPrompt) {
    const baseResponse = {
        model: model,
        original_prompt: originalPrompt,
        reframed: {
            raw: restructuredPrompt
        },
        metadata: {
            timestamp: new Date().toISOString(),
            original_length: originalPrompt.length,
            reframed_length: restructuredPrompt.length
        }
    };

    // Add model-specific API-ready format
    switch (model) {
        case 'claude':
            baseResponse.reframed.api_ready = {
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 4096,
                messages: [
                    {
                        role: "user",
                        content: restructuredPrompt
                    }
                ]
            };
            break;

        case 'chatgpt':
            baseResponse.reframed.api_ready = {
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: extractSystemPrompt(restructuredPrompt)
                    },
                    {
                        role: "user",
                        content: extractUserTask(restructuredPrompt)
                    }
                ],
                temperature: 0
            };
            break;

        case 'gemini':
            baseResponse.reframed.api_ready = {
                model: "gemini-2.5-flash",
                contents: {
                    parts: [
                        {
                            text: restructuredPrompt
                        }
                    ]
                }
            };
            break;

        case 'perplexity':
            baseResponse.reframed.api_ready = {
                model: "sonar",
                messages: [
                    {
                        role: "system",
                        content: restructuredPrompt
                    }
                ]
            };
            break;

        default:
            baseResponse.reframed.api_ready = {
                prompt: restructuredPrompt
            };
    }

    return baseResponse;
}

// Helper function to extract system prompt from ChatGPT format
function extractSystemPrompt(prompt) {
    // Look for content before any task description
    const lines = prompt.split('\n');
    let systemContent = [];

    for (let line of lines) {
        if (line.trim().startsWith('#') && systemContent.length > 0) {
            break;
        }
        systemContent.push(line);
    }

    return systemContent.join('\n').trim() || prompt;
}

// Helper function to extract user task
function extractUserTask(prompt) {
    // For now, return the full prompt as the task
    // This can be enhanced to extract specific sections
    return prompt;
}

// ================================
// Image Generation Detection
// ================================

function isImageGenerationRequest(prompt) {
    const lowerPrompt = prompt.toLowerCase();

    // Keywords that indicate image generation
    const imageKeywords = ['image', 'picture', 'photo', 'visual', 'graphic', 'illustration', 'artwork', 'thumbnail', 'poster', 'banner'];
    const creationVerbs = ['create', 'generate', 'make', 'design', 'draw', 'produce', 'craft'];
    const qualityKeywords = ['high quality', 'vibrant', 'eye-catching', 'ultra', 'stunning', 'dramatic', 'cinematic'];

    // Check if prompt mentions image generation
    const hasImageKeyword = imageKeywords.some(keyword => lowerPrompt.includes(keyword));
    const hasCreationVerb = creationVerbs.some(verb => lowerPrompt.includes(verb));
    const hasQualityKeyword = qualityKeywords.some(keyword => lowerPrompt.includes(keyword));

    // Likely image generation if has image keyword + (creation verb OR quality keyword)
    return hasImageKeyword && (hasCreationVerb || hasQualityKeyword);
}

// Image generation specific system prompt
const IMAGE_GENERATION_SYSTEM_PROMPT = `You are an expert prompt architect for image generation AI models (DALL-E, Midjourney, Stable Diffusion, etc.).

CRITICAL RULES:
1. Output ONLY the enhanced prompt - NO explanations, NO meta-commentary, NO markdown structure
2. Create a highly detailed, structured prompt optimized for exceptional AI-generated imagery
3. Preserve ALL user-specified elements exactly - do not add or remove requested subjects
4. Every word must add value - no filler or unnecessary language
5. Structure the prompt with clear logical sections for maximum AI comprehension

REQUIRED STRUCTURE (present as flowing descriptive text, NOT as labeled sections):

1. OPENING (Main Subject & Composition):
   - Lead with the primary subject(s) and their spatial arrangement
   - Specify positioning (left/right/center/foreground/background)
   - Define composition type (split-screen, diagonal, centered, rule of thirds, etc.)
   - Include camera angle (low-angle, bird's-eye, eye-level, dramatic dutch tilt, etc.)
   - Mention framing and how subjects fill the frame

2. VISUAL DETAILS (for each key element):
   - Precise descriptions: colors, textures, materials, finishes
   - Physical characteristics: shape, size, proportions
   - Dynamic elements: motion, speed indicators, action
   - Brand/subject accuracy requirements when applicable

3. LIGHTING & ATMOSPHERE:
   - Primary light source(s) and direction
   - Light quality (hard/soft, warm/cool, dramatic/subtle)
   - Rim lighting, backlighting, or special lighting effects
   - Shadows and their characteristics
   - Atmospheric effects (fog, haze, particles, god rays, etc.)

4. BACKGROUND & ENVIRONMENT:
   - Setting description (but avoid clutter - keep focus on main subjects)
   - Environmental context that enhances mood
   - Depth of field considerations (sharp/blurred background)
   - Motion blur, speed lines, or dynamic effects

5. ARTISTIC STYLE & QUALITY:
   - Rendering style (photorealistic, cinematic, hyper-realistic, painterly, etc.)
   - Visual treatment (high contrast, HDR, color grading, saturation level)
   - Technical quality (ultra-sharp, 8K, professional, high-detail)
   - Reference aesthetics if relevant (blade runner, studio Ghibli, etc.)

6. MOOD & EMOTION:
   - Overall emotional tone (dramatic, serene, intense, playful, etc.)
   - Energy level (explosive, calm, dynamic, static)
   - Intended viewer response

7. PLATFORM-SPECIFIC OPTIMIZATION (if applicable):
   - YouTube thumbnail: high contrast, large subjects, readable at small sizes
   - Social media: eye-catching, bold colors, clear focal point
   - Poster/banner: balanced composition, text space consideration

8. NEGATIVE CONSTRAINTS (subtly integrated):
   - Briefly mention what to avoid (e.g., "no cartoon style, no flat lighting, no clutter")

OUTPUT FORMAT:
Write as a continuous, flowing descriptive paragraph broken into logical sections with natural transitions. Do NOT use headers like "Scene:", "Lighting:", etc. Let the description flow organically while covering all required elements.

EXAMPLE OUTPUT:
"A high-octane head-to-head automotive clash featuring a vibrant McLaren supercar and a sleek Mercedes-Benz performance car in an explosive split-screen composition. The McLaren dominates the left third, angled aggressively toward center, painted in molten orange with glossy metallic reflections showcasing its aerodynamic curves and razor-sharp lines. The Mercedes-Benz commands the right third, positioned in a competitive stance, rendered in deep gunmetal silver with chrome accents emphasizing its engineered precision and powerful stance. Both vehicles are captured from a dramatic low camera angle that amplifies their dominance and aggression, filling 80% of the frame with minimal empty space. At the collision point where the cars converge, a massive chrome "VS" emblem with cracked electric edges and explosive spark effects radiates outward, creating a shockwave of energy. The McLaren side bathes in warm orange and red highlights with motion streaks and speed particles, while the Mercedes side glows with cool blue and silver rim lighting suggesting controlled power. Strong studio lighting with cinematic contrast creates sharp rim lighting that separates both cars from the high-energy abstract background. The background features motion blur, smoke trails, light streaks, and speed lines in complementary warm-cool gradients, avoiding any distracting detailed scenery. Ultra-sharp focus on both vehicles, hyper-realistic rendering with extreme detail, high saturation with controlled highlights, designed for maximum visual impact at small thumbnail sizes. Professional automotive photography style, cinematic color grading, no cartoon elements, no flat lighting, no cluttered backgrounds, no extraneous text beyond the central VS emblem. Optimized for YouTube thumbnail with instant readability and maximum click-through appeal."

Your task: Transform the user's image request into a comprehensive, structured prompt following this approach.`;

// ================================
// API Routes
// ================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Check ambiguity
app.post('/api/check-ambiguity', (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const result = detectAmbiguity(prompt);
        res.json(result);

    } catch (error) {
        console.error('Ambiguity check error:', error);
        res.status(500).json({ error: 'Failed to check ambiguity' });
    }
});

// Reframe prompt
app.post('/api/reframe', async (req, res) => {
    try {
        const { raw_prompt, model, clarifications } = req.body;

        if (!raw_prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        if (!model || !MODEL_TEMPLATES[model]) {
            return res.status(400).json({ error: 'Invalid model specified' });
        }

        // Check if OpenAI API key is configured
        if (!process.env.OPENAI_API_KEY) {
            console.warn('⚠️  OpenAI API key not configured, returning original prompt');
            return res.json({
                restructured_prompt: raw_prompt,
                model: model,
                error: 'API key not configured',
                timestamp: new Date().toISOString()
            });
        }

        // Build clarification context
        let clarificationContext = '';
        if (clarifications && Object.keys(clarifications).length > 0) {
            clarificationContext = '\n\nClarifications provided by user:\n';
            for (const [key, value] of Object.entries(clarifications)) {
                clarificationContext += `- ${key}: ${value}\n`;
            }
        }

        // Detect if this is an image generation request
        const isImageRequest = isImageGenerationRequest(raw_prompt);

        // Get appropriate system prompt
        const systemPrompt = isImageRequest
            ? IMAGE_GENERATION_SYSTEM_PROMPT
            : MODEL_TEMPLATES[model].systemPrompt;

        // Call GPT-4o-mini (placeholder for GPT-5 mini)
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0, // Deterministic output
            messages: [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: `Original prompt: ${raw_prompt}${clarificationContext}`
                }
            ]
        });

        const restructuredPrompt = completion.choices[0].message.content.trim();

        // Format response with model-specific API-ready structure
        const formattedResponse = formatForModel(model, restructuredPrompt, raw_prompt);

        res.json(formattedResponse);

    } catch (error) {
        console.error('Reframe error:', error);

        // Return formatted original prompt on error
        const errorResponse = formatForModel(req.body.model, req.body.raw_prompt, req.body.raw_prompt);
        errorResponse.error = 'Automatic restructuring unavailable';

        res.json(errorResponse);
    }
});

// Authentication routes (only if OAuth configured)
if (oauthConfigured) {
    app.get('/api/auth/google',
        passport.authenticate('google', { scope: ['profile', 'email'] })
    );

    app.get('/api/auth/google/callback',
        passport.authenticate('google', { failureRedirect: '/login' }),
        (req, res) => {
            res.redirect(process.env.FRONTEND_URL || 'http://localhost:8080');
        }
    );
} else {
    app.get('/api/auth/google', (req, res) => {
        res.status(503).json({ error: 'OAuth not configured' });
    });

    app.get('/api/auth/google/callback', (req, res) => {
        res.status(503).json({ error: 'OAuth not configured' });
    });
}

app.get('/api/auth/logout', (req, res) => {
    req.logout(() => {
        res.json({ success: true });
    });
});

app.get('/api/auth/user', (req, res) => {
    if (req.isAuthenticated()) {
        res.json(req.user);
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

// Saved prompts routes
app.get('/api/prompts', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = req.user.id;
    const userPrompts = savedPrompts.get(userId) || [];

    res.json(userPrompts);
});

app.post('/api/prompts/save', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = req.user.id;
    const prompt = {
        id: Date.now().toString(),
        ...req.body,
        savedAt: new Date().toISOString()
    };

    if (!savedPrompts.has(userId)) {
        savedPrompts.set(userId, []);
    }

    savedPrompts.get(userId).push(prompt);

    res.json({ success: true, prompt });
});

// ================================
// Start Server
// ================================

app.listen(PORT, () => {
    console.log('========================================');
    console.log(`✓ Reframe backend running on port ${PORT}`);
    console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✓ Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:8080'}`);

    if (process.env.OPENAI_API_KEY) {
        console.log('✓ OpenAI API configured');
    } else {
        console.warn('⚠️  OpenAI API key not set - reframing will return original prompts');
    }

    if (oauthConfigured) {
        console.log('✓ Google OAuth configured');
    } else {
        console.warn('⚠️  Google OAuth not configured - authentication disabled');
    }

    console.log('========================================');
    console.log('Ready to accept connections');
});




