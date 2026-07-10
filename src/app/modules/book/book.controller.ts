/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { BookService } from './book.service';

// CREATE Book
export const createBookController = async (req: Request, res: Response) => {
  try {
    const book = await BookService.createBookServices(req.body);
    res.status(201).json({ success: true, message: 'Book created successfully', data: book });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET All Books (supports ?search=&category=&language=&format=&sort=&page=&limit=&status=)
export const getAllBooksController = async (req: Request, res: Response) => {
  try {
    const { search, category, language, format, sort, page, limit, status } = req.query;
    const result = await BookService.getAllBooksServices({
      search: search as string,
      category: category as string,
      language: language as string,
      format: format as string,
      status: status as string,
      sort: sort as string,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      publicOnly: !status, // Public API shows only published unless admin specifies status
    });
    res.status(200).json({
      success: true,
      data: result.books,
      meta: { total: result.total, page: result.page, totalPages: result.totalPages },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET Single Book by slug (also resolves numeric id / _id) — includes public preview
export const getSingleBookController = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const book = await BookService.getSingleBookServices(slug);
    if (!book) return res.status(404).json({ success: false, message: 'Book not found' });
    res.status(200).json({ success: true, data: book });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// UPDATE Book by _id
export const updateBookController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updatedBook = await BookService.updateBookServices(id, req.body);
    if (!updatedBook) return res.status(404).json({ success: false, message: 'Book not found' });
    res.status(200).json({ success: true, message: 'Book updated successfully', data: updatedBook });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE Book by _id
export const deleteBookController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deletedBook = await BookService.deleteBookServices(id);
    if (!deletedBook) return res.status(404).json({ success: false, message: 'Book not found' });
    res.status(200).json({ success: true, message: 'Deleted successfully', data: deletedBook });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const BookController = {
  createBookController,
  getAllBooksController,
  getSingleBookController,
  updateBookController,
  deleteBookController,
};
