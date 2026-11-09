import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { HttpError } from '../lib/http.js';
import { config } from '../config.js';

export const uploadRouter = Router();

const uploadDir = path.resolve(config.MUSIC_DIR || './media');

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, `${Date.now()}_${decodedName}`);
  }
});

// .any() принимает файлы с абсолютно любым именем поля от фронтенда
const upload = multer({ storage }).any();

uploadRouter.post('/', authenticate(), (req, res, next) => {
  upload(req, res, async (err: any) => {
    try {
      if (err) {
        throw new HttpError(400, 'multer_error', err.message);
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        throw new HttpError(400, 'no_files', 'Файлы не были переданы');
      }

      const results = [];
      const userId = (req as any).user.id;

      for (const file of files) {
        const originalName = file.originalname.includes('_') 
          ? file.originalname.split('_').slice(1).join('_') 
          : file.originalname;
        const decodedName = Buffer.from(originalName, 'latin1').toString('utf8');
        const parsedName = path.parse(decodedName);
        
        let artist = 'Unknown Artist';
        let title = parsedName.name;

        if (parsedName.name.includes(' - ')) {
          const parts = parsedName.name.split(' - ');
          artist = parts[0].trim();
          title = parts.slice(1).join(' - ').trim();
        } else if (parsedName.name.includes('-')) {
          const parts = parsedName.name.split('-');
          artist = parts[0].trim();
          title = parts.slice(1).join('-').trim();
        }

        const fileHash = crypto.createHash('md5').update(file.path + Date.now() + Math.random()).digest('hex');

        let track = await prisma.track.findFirst({
          where: { ownerId: userId, title, artist }
        });

        if (!track) {
          track = await prisma.track.create({
            data: {
              title,
              artist,
              filePath: file.path,
              fileSize: file.size,
              duration: 0,
              fileHash,
              fileMtimeMs: Date.now(),
              matchKey: `${artist} - ${title}`.toLowerCase(),
              status: 'PARSED',
              owner: {
                connect: { id: userId }
              }
            }
          });
        }

        results.push({
          id: track.id,
          name: decodedName,
          status: 'success'
        });
      }

      return res.json({ results, success: true });
    } catch (error: any) {
      console.error('[Upload Error]', error);
      return res.status(error.status || 500).json({ 
        error: error.code || 'upload_error', 
        message: error.message || 'Ошибка при загрузке файлов' 
      });
    }
  });
});

export default uploadRouter;
