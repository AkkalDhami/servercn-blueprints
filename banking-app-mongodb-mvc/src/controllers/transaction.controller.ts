import { NextFunction, Response } from "express";
import { AsyncHandler } from "../utils/async-handler";
import { CreateTransactionType } from "../validators/transaction";
import { TranscationService } from "../services/transaction.service";
import { ApiError } from "../utils/api-error";
import { UserRequest } from "../types/user";
import { ApiResponse } from "../utils/api-response";

//? Create transaction
export const createTransaction = AsyncHandler(
  async (req: UserRequest, res: Response, next: NextFunction) => {
    const data: CreateTransactionType = req.body;

    const userId = req?.user?._id;
    if (!userId) {
      return next(ApiError.unauthorized("User not authenticated"));
    }

    await TranscationService.createTransaction({
      ...data,
      currentUserId: userId
    });
    res.status(201).json({
      success: true,
      message: "Transaction created successfully"
    });
  }
);

//? create system initial transaction
export const createSystemInitialTransaction = AsyncHandler(
  async (req: UserRequest, res: Response, next: NextFunction) => {
    const data: CreateTransactionType = req.body;

    const userId = req?.user?._id;
    if (!userId) {
      return next(ApiError.unauthorized("User not authenticated"));
    }

    await TranscationService.createInitialTransaction(data);
    return ApiResponse.created(
      res,
      "System initial transaction created successfully"
    );
  }
);
