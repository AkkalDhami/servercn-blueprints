import { AccountService } from "./account.service";
import Account from "../models/account.model";
import Transaction from "../models/transaction.model";
import { ApiError } from "../utils/api-error";
import { CreateTransactionType } from "../validators/transaction";
import mongoose from "mongoose";
import { Ledger } from "../models/ledger.model";
import { sendEmail } from "../utils/send-mail";
import { AuthService } from "./auth.service";

export class TranscationService {
  static async createTransaction(
    data: CreateTransactionType & { currentUserId: string }
  ) {
    //? check if from and to account id are exist
    const [fromAccount] = await Account.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(data.fromAccountId)
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userId",
          pipeline: [
            {
              $project: {
                email: 1,
                _id: 1
              }
            }
          ]
        }
      },
      {
        $unwind: "$userId"
      }
    ]);
    const [toAccount] = await Account.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(data.toAccountId)
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userId",
          pipeline: [
            {
              $project: {
                email: 1,
                _id: 1
              }
            }
          ]
        }
      },
      {
        $unwind: "$userId"
      }
    ]);

    if (!fromAccount) {
      throw ApiError.badRequest("Invalid from accountId");
    }
    if (!toAccount) {
      throw ApiError.badRequest("Invalid to accountId");
    }

    //? check if current user is authorized to perform this transaction

    const currentUserAccount = await AuthService.getUserProfile(
      data.currentUserId
    );

    if (!currentUserAccount) {
      throw ApiError.unauthorized("Unauthorized access");
    }

    console.log(currentUserAccount);

    if (!currentUserAccount.accounts.includes(fromAccount._id)) {
      throw ApiError.unauthorized("Unauthorized access");
    }

    if (fromAccount._id.equals(toAccount._id)) {
      throw ApiError.badRequest("Cannot transfer to the same account");
    }

    //? check idempotencyKey already exist
    const transactionExist = await Transaction.findOne({
      idempotencyKey: data.idempotencyKey
    });

    if (transactionExist) {
      if (transactionExist.status === "completed") {
        throw ApiError.badRequest("Transaction already completed");
      }

      if (transactionExist.status === "pending") {
        throw ApiError.badRequest("Transaction is still pending");
      }

      if (transactionExist.status === "failed") {
        throw ApiError.badRequest("Transaction failed, please try again");
      }
    }

    //? check both account status
    if (fromAccount.status !== "active") {
      throw ApiError.badRequest("From account is not active");
    }
    if (toAccount.status !== "active") {
      throw ApiError.badRequest("To account is not active");
    }

    //? check if from account have sufficient balance
    const balance = await AccountService.getBalance(fromAccount._id);
    if (balance < data.amount) {
      throw ApiError.badRequest("Insufficient balance");
    }

    //? create transaction
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const [transaction] = await Transaction.create(
        [
          {
            ...data,
            status: "pending"
          }
        ],
        { session }
      );
      if (!transaction) {
        await session.abortTransaction();
        throw ApiError.badRequest("Transaction creation failed");
      }

      const debitEntry = await Ledger.create(
        [
          {
            accountId: fromAccount._id,
            transactionId: transaction._id,
            amount: data.amount,
            entryType: "debit"
          }
        ],
        { session }
      );

      const creditEntry = await Ledger.create(
        [
          {
            accountId: toAccount._id,
            transactionId: transaction._id,
            amount: data.amount,
            entryType: "credit"
          }
        ],
        { session }
      );

      if (!debitEntry || !creditEntry) {
        await session.abortTransaction();
        throw ApiError.badRequest("Ledger entry creation failed");
      }

      //? update transaction status to completed
      await Transaction.findByIdAndUpdate(
        transaction._id,
        { status: "completed" },
        { session }
      );

      //? send email notification to both account owner
      Promise.all([
        sendEmail({
          email: fromAccount.userId?.email || "",
          subject: "Transaction Notification",
          html: `Your transaction of NPR ${data.amount} to account ${toAccount._id} has been processed.`
        }),
        sendEmail({
          email: toAccount.userId?.email || "",
          subject: "Transaction Notification",
          html: `You received a transaction of NPR ${data.amount} from account ${fromAccount._id}.`
        })
      ]);
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

    await session.commitTransaction();
    return;
  }

  static async createInitialTransaction(
    data: CreateTransactionType
  ): Promise<void> {
    const [toAccount] = await Account.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(data.toAccountId)
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userId",
          pipeline: [{ $project: { email: 1 } }]
        }
      },
      { $unwind: "$userId" }
    ]);

    if (!toAccount) {
      throw ApiError.badRequest("Invalid to accountId");
    }

    const [fromAccount] = await Account.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(data.fromAccountId),
          systemAccount: true
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userId",
          pipeline: [{ $project: { email: 1 } }]
        }
      },
      { $unwind: "$userId" }
    ]);

    if (!fromAccount) {
      throw ApiError.badRequest("Invalid system account");
    }

    if (fromAccount._id.equals(toAccount._id)) {
      throw ApiError.badRequest("Cannot transfer to the same account");
    }

    //? check fromAccount is active
    if (fromAccount.status !== "active") {
      throw ApiError.badRequest("From account is not active");
    }

    //? check toAccount is active
    if (toAccount.status !== "active") {
      throw ApiError.badRequest("To account is not active");
    }

    //? check idempotencyKey already exist
    const transactionExist = await Transaction.findOne({
      idempotencyKey: data.idempotencyKey
    });

    if (transactionExist) {
      if (transactionExist.status === "completed") {
        throw ApiError.badRequest("Transaction already completed");
      }

      if (transactionExist.status === "pending") {
        throw ApiError.badRequest("Transaction is still pending");
      }

      if (transactionExist.status === "failed") {
        throw ApiError.badRequest("Transaction failed, please try again");
      }
    }

    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      // Create transaction
      const [transaction] = await Transaction.create(
        [
          {
            fromAccountId: fromAccount._id,
            toAccountId: toAccount._id,
            amount: data.amount,
            idempotencyKey: data.idempotencyKey,
            status: "pending"
          }
        ],
        { session }
      );
      if (!transaction) {
        await session.abortTransaction();
        throw ApiError.badRequest("Transaction creation failed");
      }

      // Create ledger entries (double-entry)
      const entries = await Ledger.insertMany(
        [
          {
            accountId: fromAccount._id,
            transactionId: transaction._id,
            amount: data.amount,
            entryType: "debit"
          },
          {
            accountId: toAccount._id,
            transactionId: transaction._id,
            amount: data.amount,
            entryType: "credit"
          }
        ],
        { session }
      );

      if (!entries) {
        await session.abortTransaction();
        throw ApiError.badRequest("Ledger entry creation failed");
      }

      // Mark transaction as completed
      transaction.status = "completed";
      await transaction.save({ session });

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}
