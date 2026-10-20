import { describe, expect, it } from 'vitest';
import { renderTttCard } from './ttt-card-renderer.js';
import { EMPTY_BOARD, getResult, type TttBoard } from './ttt-logic.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const wonBoard: TttBoard = ['X', 'O', 'X', 'O', 'X', 'O', null, null, 'X'];
const drawBoard: TttBoard = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];

describe('renderTttCard', () => {
    it('renderuje wygrana z linia zwyciestwa', async () => {
        const result = await renderTttCard({
            xName: 'Ala',
            oName: 'Ola',
            board: wonBoard,
            result: getResult(wonBoard),
        });

        expect(result.byteLength).toBeGreaterThan(1000);
        expect(result.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });

    it('renderuje remis oraz walkower (zwyciezca bez linii na planszy)', async () => {
        const draw = await renderTttCard({ xName: 'Ala', oName: 'Ola', board: drawBoard, result: getResult(drawBoard) });
        const walkover = await renderTttCard({ xName: 'Ala', oName: 'Ola', board: EMPTY_BOARD, winnerMark: 'O' });

        expect(draw.subarray(0, 8)).toEqual(PNG_SIGNATURE);
        expect(walkover.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });

    it('radzi sobie z dlugim nickiem, pustym nickiem i zlym URL awatara', async () => {
        const result = await renderTttCard({
            xName: 'BardzoDlugiNickKtoryPowinienZostacPrzyciety',
            oName: '',
            xAvatarUrl: 'not-a-valid-avatar-url',
            board: wonBoard,
            result: getResult(wonBoard),
        });

        expect(result.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });
});
