/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { OrderService } from './order.service';

// CREATE order (auth) — computes prices server-side, returns pending order
const createOrder = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const order = await OrderService.createOrder(user._id, req.body);
    res.status(201).json({ success: true, message: 'Order created', data: order });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// GET my orders (auth)
const getMyOrders = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const orders = await OrderService.getMyOrders(user._id);
    res.status(200).json({ success: true, data: orders });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET single order (auth owner or admin)
const getOrderById = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const order = await OrderService.getOrderById(req.params.id, user);
    res.status(200).json({ success: true, data: order });
  } catch (error: any) {
    const code = error.message?.includes('not allowed') ? 403 : 404;
    res.status(code).json({ success: false, message: error.message });
  }
};

// GET all orders (admin, paginated + status filter)
const getAllOrders = async (req: Request, res: Response) => {
  try {
    const { status, page, limit } = req.query;
    const result = await OrderService.getAllOrders({
      status: status as string,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
    res.status(200).json({
      success: true,
      data: result.orders,
      meta: { total: result.total, page: result.page, totalPages: result.totalPages },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH status (admin fulfillment)
const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const order = await OrderService.updateOrderStatus(req.params.id, req.body.status);
    res.status(200).json({ success: true, message: 'Order status updated', data: order });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// POST pay via bKash (auth)
const payWithBkash = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await OrderService.payWithBkash(req.params.id, user._id);
    res.status(200).json({ success: true, message: 'bKash payment initiated', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// POST pay via SSLCommerz (auth)
const payWithSslcommerz = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await OrderService.payWithSslcommerz(req.params.id, user._id);
    res.status(200).json({ success: true, message: 'SSLCommerz session initiated', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// POST complete payment (auth, DEMO / callback)
const completePayment = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const order = await OrderService.completePayment(req.params.id, user._id, req.body);
    res.status(200).json({ success: true, message: 'Payment completed', data: order });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// GET download secure file for a purchased digital book (auth owner or admin)
const downloadBook = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id, bookId } = req.params;
    const result = await OrderService.getDownloadUrl(id, bookId, user);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    const code = error.message?.includes('not allowed') ? 403 : 400;
    res.status(code).json({ success: false, message: error.message });
  }
};

export const OrderController = {
  createOrder,
  getMyOrders,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
  payWithBkash,
  payWithSslcommerz,
  completePayment,
  downloadBook,
};
