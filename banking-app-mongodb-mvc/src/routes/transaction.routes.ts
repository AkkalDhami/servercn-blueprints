import { Router } from "express";
import { verifyAuthentication } from "../middlewares/verify-auth";
import { checkUserAccountRestriction } from "../middlewares/user-account-restriction";
import { validateRequest } from "../middlewares/validate-request";
import {
  createSystemInitialTransaction,
  createTransaction
} from "../controllers/transaction.controller";
import { createTransactionSchema } from "../validators/transaction";
import { verifySystemUser } from "../middlewares/verify-system-user";

const router = Router();

router.post(
  "/system-init",
  verifyAuthentication,
  verifySystemUser,
  checkUserAccountRestriction,
  validateRequest(createTransactionSchema),
  createSystemInitialTransaction
);

router.post(
  "/",
  verifyAuthentication,
  checkUserAccountRestriction,
  validateRequest(createTransactionSchema),
  createTransaction
);

export default router;
