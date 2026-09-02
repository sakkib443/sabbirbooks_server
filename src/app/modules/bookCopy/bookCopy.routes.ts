import { Router } from 'express';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';
import * as C from './bookCopy.controller';

const router = Router();

// ── The reader's two ──
//
// Redeeming needs an account, because a code grants access TO an account —
// there is nowhere else to put it. The page in front of this creates one when
// the reader does not have it, so from the API's side it is always signed in.
router.post('/redeem', authMiddleware, C.redeemCode);
router.get('/mine', authMiddleware, C.myCodes);

// ── Admin ──
//
// Minting codes is printing money's worth of access, so it rides on
// content.write (the capability that already gates the book's own contents)
// rather than on an order capability. Voiding one is the same decision in
// reverse. Reading the list is the same gate — a list of unredeemed codes IS
// the codes.
const write = [authMiddleware, authorize('admin', 'manager'), requireCapability('content.write')];

router.get('/', ...write, C.listCodes);
router.get('/export', ...write, C.exportCodes);
router.post('/generate', ...write, C.generateCodes);
router.patch('/:id/void', ...write, C.voidCode);

export const BookCopyRoutes = router;
