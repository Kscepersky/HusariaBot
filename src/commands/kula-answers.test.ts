import { describe, expect, it } from 'vitest';
import {
    ANIMATION_MESSAGES,
    NO_ANSWERS,
    YES_ANSWERS,
    pickAnimationMessages,
    rollKulaAnswer,
} from './kula-answers.js';

describe('rollKulaAnswer', () => {
    it('zwraca odpowiedz twierdzaca dla niskiej wartosci losowej', () => {
        const answer = rollKulaAnswer(() => 0);
        expect(answer.verdict).toBe('yes');
        expect(YES_ANSWERS).toContain(answer.text);
    });

    it('zwraca odpowiedz przeczaca dla wysokiej wartosci losowej', () => {
        const answer = rollKulaAnswer(() => 0.999999);
        expect(answer.verdict).toBe('no');
        expect(NO_ANSWERS).toContain(answer.text);
    });

    it('losuje wariant tekstu z puli', () => {
        const first = rollKulaAnswer(() => 0.01);
        const last = rollKulaAnswer(() => 0.49);
        expect(first.text).not.toBe(last.text);
    });

    it('daje obie odpowiedzi w losowych wywolaniach', () => {
        const verdicts = new Set(Array.from({ length: 200 }, () => rollKulaAnswer().verdict));
        expect(verdicts).toEqual(new Set(['yes', 'no']));
    });
});

describe('pickAnimationMessages', () => {
    it('zwraca zadana liczbe roznych komunikatow z puli', () => {
        const messages = pickAnimationMessages(3);

        expect(messages).toHaveLength(3);
        expect(new Set(messages).size).toBe(3);
        messages.forEach((message) => expect(ANIMATION_MESSAGES).toContain(message));
    });

    it('nie zwraca wiecej komunikatow niz jest w puli', () => {
        expect(pickAnimationMessages(ANIMATION_MESSAGES.length + 5)).toHaveLength(ANIMATION_MESSAGES.length);
    });
});
