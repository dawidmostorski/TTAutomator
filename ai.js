const OpenAI = require('openai');

/**
 * Moduł AI - generowanie naturalnych komentarzy używając OpenAI
 */
class AICommentGenerator {
    constructor(apiKey, customConfig = {}) {
        this.client = new OpenAI({
            apiKey: apiKey
        });

        // Konfiguracja - użyj ?? zamiast || aby pusty string nie był ignorowany
        this.systemPrompt = customConfig.systemPrompt ?? 'Jesteś osobą przeglądającą TikToka. Twoje komentarze są krótkie, naturalne, spontaniczne i po polsku. Nie używasz emoji zbyt często. Komentarze powinny być luźne i autentyczne, jak od prawdziwego użytkownika.';

        // DEBUG: Pokaż jaki prompt jest używany
        console.log(`🎯 [AI] Używam systemPrompt: "${this.systemPrompt.substring(0, 60)}..."`);
    }

    /**
     * Generuje naturalny komentarz na podstawie kontekstu filmu
     * @param {Object} videoContext - Obiekt z danymi: { description, author, music, likes }
     * @returns {Promise<string>} - Wygenerowany komentarz
     */
    async generateComment(videoContext) {
        try {
            // Obsługa starego formatu (gdyby przekazano tylko string)
            const context = typeof videoContext === 'string'
                ? { description: videoContext, author: 'Nieznany', music: 'Nieznana', likes: '' }
                : videoContext;

            console.log('🤖 Generuję komentarz AI na podstawie bogatego kontekstu...');
            console.log(`📊 Dane: Autor=[${context.author}], Muzyka=[${context.music}], Opis=[${context.description.substring(0, 50)}...]`);

            const prompt = this.buildPrompt(context);

            const response = await this.client.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: this.systemPrompt
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 60,
                temperature: 0.85,
                presence_penalty: 0.5,
                frequency_penalty: 0.5
            });

            const comment = response.choices[0].message.content.trim();
            const cleanedComment = comment.replace(/^["']|["']$/g, '');

            console.log(`💬 Wygenerowany komentarz: "${cleanedComment}"`);

            return cleanedComment;
        } catch (error) {
            console.error('❌ Błąd podczas generowania komentarza:', error.message);
            return this.getFallbackComment();
        }
    }

    /**
     * Buduje prompt dla OpenAI
     */
    buildPrompt(context) {
        // Wyciągnij kluczowe instrukcje z systemPrompt (pierwsze 150 znaków)
        const shortInstruction = this.systemPrompt ? this.systemPrompt.substring(0, 150) : '';

        return `Skomentuj ten film TikToka:

- AUTOR: "${context.author}"
- OPIS: "${context.description}"
- MUZYKA: "${context.music}"
${context.likes ? `- POLUBIENIA: "${context.likes}"` : ''}

⚠️ PAMIĘTAJ O INSTRUKCJI: ${shortInstruction}

Odpowiedz TYLKO treścią komentarza (bez cudzysłowów). Max 1 emoji.`;
    }

    /**
     * Zwraca losowy komentarz z puli fallback (gdy API zawiedzie)
     */
    getFallbackComment() {
        const fallbackComments = [
            'Super!',
            'Wow, ciekawe',
            'Haha dobre',
            'Kozak 👍',
            'Nice',
            'Mega!',
            'Świetne',
            'Cudne ❤️',
            'To było dobre',
            'No i git'
        ];

        const randomIndex = Math.floor(Math.random() * fallbackComments.length);
        const comment = fallbackComments[randomIndex];

        console.log(`💬 Używam fallback komentarza: "${comment}"`);
        return comment;
    }

    /**
     * Analizuje screenshot panelu komentarzy używając GPT-4 Vision
     * @param {string} screenshotBase64 - Screenshot w formacie base64
     * @param {string} replyPrompt - Prompt użytkownika dla odpowiedzi
     * @returns {Promise<Object>} - { found, commentPosition, commentText, authorName, reason, suggestedReply }
     */
    async analyzeComments(screenshotBase64, replyPrompt) {
        try {
            console.log('🔍 [AI Vision] Analizuję komentarze na screenshocie...');

            const systemPrompt = replyPrompt || `Jesteś zwykłym użytkownikiem TikToka który odpowiada na komentarze innych osób.

ZASADY:
- Max 12 słów, po polsku, max 1 emoji
- Odpowiadaj na TREŚĆ komentarza, nie ignoruj go
- Bądź naturalny, jakbyś rozmawiał ze znajomym

STRATEGIE (dopasuj do komentarza):
1. ZGODA - jeśli komentarz jest pozytywny ("no właśnie!", "dokładnie tak")
2. DYSKUSJA - jeśli to pytanie, odpowiedz merytorycznie
3. ŻART - jeśli komentarz jest śmieszny, dodaj coś od siebie
4. DOPYTANIE - zadaj pytanie zwrotne ("a Ty jak to robisz?")

SUBTELNE ZACHĘTY (wpleć naturalnie, nie zawsze):
- "u mnie na profilu więcej" / "wrzucam podobne rzeczy"
- Nigdy wprost "follow" ani "obserwuj mnie"

UNIKAJ:
- Generycznych "haha tak!" bez odniesienia do treści
- Ignorowania tego co napisał autor komentarza
- Nachalnej promocji`;

            const response = await this.client.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: `Przeanalizuj komentarze na tym screenshocie.

Znajdź komentarz który:
- Ma dużo lajków (popularny) LUB
- Jest pytaniem / zaprasza do dyskusji

Odpowiedz w formacie JSON:
{
  "found": true/false,
  "commentPosition": "góra/środek/dół",
  "commentText": "treść komentarza",
  "authorName": "nazwa autora",
  "reason": "dlaczego wybrałeś ten komentarz",
  "suggestedReply": "Twoja sugerowana odpowiedź"
}

Jeśli nie ma odpowiednich komentarzy, zwróć "found": false.`
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:image/png;base64,${screenshotBase64}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 300,
                temperature: 0.7
            });

            const content = response.choices[0].message.content.trim();
            console.log(`📝 [AI Vision] Odpowiedź: ${content.substring(0, 100)}...`);

            // Usunięcie markdown code blocks jeśli są obecne
            let jsonContent = content;
            if (jsonContent.startsWith('```json')) {
                jsonContent = jsonContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            } else if (jsonContent.startsWith('```')) {
                jsonContent = jsonContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
            }

            // Parsuj JSON z odpowiedzi
            const result = JSON.parse(jsonContent);

            if (result.found) {
                console.log(`✅ [AI Vision] Znaleziono komentarz: "${result.commentText}" od @${result.authorName}`);
                console.log(`💡 [AI Vision] Sugerowana odpowiedź: "${result.suggestedReply}"`);
            } else {
                console.log('⚠️ [AI Vision] Nie znaleziono odpowiedniego komentarza');
            }

            return result;

        } catch (error) {
            console.error('❌ [AI Vision] Błąd podczas analizy komentarzy:', error.message);

            // Retry raz po 2 sekundach
            if (!error.retried) {
                console.log('🔄 [AI Vision] Próbuję ponownie za 2s...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                error.retried = true;
                return this.analyzeComments(screenshotBase64, replyPrompt);
            }

            // Zwróć "nie znaleziono" w przypadku błędu
            return {
                found: false,
                commentPosition: null,
                commentText: null,
                authorName: null,
                reason: `Błąd API: ${error.message}`,
                suggestedReply: null
            };
        }
    }

    /**
     * Generuje opis i hashtagi dla filmu TikTok na podstawie nazwy pliku.
     * Używane gdy brak pliku .txt z konfiguracją.
     * @param {string} filename - nazwa pliku video (np. "trening-klatka-dzien5.mp4")
     * @returns {Promise<{description: string, hashtags: string}>}
     */
    async generateVideoDescription(filename) {
        try {
            console.log(`🤖 [AI] Generuję opis dla: ${filename}`);

            const response = await this.client.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'Jesteś twórcą treści na TikToku. Generujesz krótkie, chwytliwe opisy po polsku.'
                    },
                    {
                        role: 'user',
                        content: `Wygeneruj krótki opis i hashtagi dla filmu TikTok o nazwie: "${filename}".\n\nOdpowiedz w formacie JSON (bez markdown):\n{\n  "description": "chwytliwy opis po polsku (max 150 znaków)",\n  "hashtags": "#tag1 #tag2 #tag3 #tag4 #tag5"\n}`
                    }
                ],
                max_tokens: 150,
                temperature: 0.8
            });

            const content = response.choices[0].message.content.trim();
            let jsonContent = content;
            if (jsonContent.startsWith('```')) {
                jsonContent = jsonContent.replace(/^```json?\s*/, '').replace(/\s*```$/, '');
            }

            const result = JSON.parse(jsonContent);
            console.log(`✅ [AI] Opis: "${result.description}"`);
            console.log(`✅ [AI] Hashtagi: ${result.hashtags}`);
            return result;
        } catch (e) {
            console.error('❌ [AI] Błąd generowania opisu:', e.message);
            return {
                description: '',
                hashtags: '#fyp #foryou #viral #polska'
            };
        }
    }
}

module.exports = AICommentGenerator;
