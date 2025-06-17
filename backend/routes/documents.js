const express = require('express');
const { body, validationResult } = require('express-validator');
const Document = require('../models/Document');
const Property = require('../models/Property');
const { auth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

const router = express.Router();

// Configuration de multer pour l'upload de documents
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = path.join(process.env.UPLOAD_PATH || './uploads', 'documents');
    try {
      await fs.mkdir(uploadPath, { recursive: true });
      cb(null, uploadPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `doc-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
    files: 5
  },
  fileFilter: (req, file, cb) => {
    // Types de fichiers autorisés
    const allowedTypes = /pdf|doc|docx|xls|xlsx|ppt|pptx|txt|jpg|jpeg|png|gif|webp|zip|rar/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || 
                    file.mimetype.includes('document') || 
                    file.mimetype.includes('spreadsheet') || 
                    file.mimetype.includes('presentation');

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Type de fichier non autorisé'));
    }
  }
});

// Validation pour les documents
const documentValidation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Le nom doit contenir entre 1 et 200 caractères'),
  body('category')
    .isIn(['contrat', 'diagnostic', 'facture', 'photo', 'plan', 'compromis', 'acte_vente', 'pret', 'assurance', 'expertise', 'correspondance', 'autre'])
    .withMessage('Catégorie invalide'),
  body('property')
    .isMongoId()
    .withMessage('ID de propriété invalide')
];

// Fonction pour calculer le checksum d'un fichier
const calculateChecksum = async (filePath) => {
  try {
    const fileBuffer = await fs.readFile(filePath);
    return crypto.createHash('md5').update(fileBuffer).digest('hex');
  } catch (error) {
    console.error('Erreur lors du calcul du checksum:', error);
    return null;
  }
};

// @route   GET /api/documents/property/:propertyId
// @desc    Obtenir tous les documents d'une propriété
// @access  Private
router.get('/property/:propertyId', auth, async (req, res) => {
  try {
    // Vérifier que l'utilisateur a accès à cette propriété
    const property = await Property.findOne({
      _id: req.params.propertyId,
      $or: [
        { owner: req.user.id },
        { 'sharedWith.user': req.user.id }
      ]
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Propriété non trouvée'
      });
    }

    const { category, type, search, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    // Construire le filtre
    const filter = { 
      property: req.params.propertyId,
      isActive: true 
    };
    
    if (category) filter.category = category;
    if (type) filter.type = type;
    if (search) {
      filter.$or = [
        { name: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') },
        { tags: new RegExp(search, 'i') }
      ];
    }

    // Options de tri
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const documents = await Document.find(filter)
      .sort(sortOptions)
      .populate('uploadedBy', 'firstName lastName email')
      .populate('step', 'name category')
      .populate('sharedWith.user', 'firstName lastName email');

    // Calculer les statistiques
    const stats = {
      total: documents.length,
      byCategory: {},
      byType: {},
      totalSize: documents.reduce((sum, doc) => sum + doc.file.size, 0)
    };

    documents.forEach(doc => {
      stats.byCategory[doc.category] = (stats.byCategory[doc.category] || 0) + 1;
      stats.byType[doc.type] = (stats.byType[doc.type] || 0) + 1;
    });

    res.json({
      success: true,
      data: {
        documents,
        stats
      }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des documents:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   GET /api/documents/:id
// @desc    Obtenir un document spécifique
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id)
      .populate('property', 'title owner')
      .populate('uploadedBy', 'firstName lastName email')
      .populate('step', 'name category')
      .populate('sharedWith.user', 'firstName lastName email')
      .populate('versions.uploadedBy', 'firstName lastName email');

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document non trouvé'
      });
    }

    // Vérifier que l'utilisateur a accès à ce document
    const hasAccess = document.property.owner.toString() === req.user.id ||
                     document.sharedWith.some(share => share.user._id.toString() === req.user.id);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      });
    }

    res.json({
      success: true,
      data: { document }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération du document:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   POST /api/documents
// @desc    Uploader un nouveau document
// @access  Private
router.post('/', auth, upload.single('file'), documentValidation, async (req, res) => {
  try {
    // Vérifier les erreurs de validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Aucun fichier fourni'
      });
    }

    // Vérifier que l'utilisateur possède la propriété
    const property = await Property.findOne({
      _id: req.body.property,
      owner: req.user.id
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Propriété non trouvée'
      });
    }

    // Calculer le checksum du fichier
    const checksum = await calculateChecksum(req.file.path);

    // Créer le document
    const documentData = {
      ...req.body,
      uploadedBy: req.user.id,
      file: {
        originalName: req.file.originalname,
        filename: req.file.filename,
        path: req.file.path,
        size: req.file.size,
        mimeType: req.file.mimetype,
        encoding: req.file.encoding,
        checksum
      },
      tags: req.body.tags ? req.body.tags.split(',').map(tag => tag.trim()) : []
    };

    const document = new Document(documentData);
    await document.save();

    await document.populate('uploadedBy', 'firstName lastName email');

    res.status(201).json({
      success: true,
      message: 'Document uploadé avec succès',
      data: { document }
    });
  } catch (error) {
    console.error('Erreur lors de l\'upload du document:', error);
    
    // Supprimer le fichier en cas d'erreur
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Erreur lors de la suppression du fichier:', unlinkError);
      }
    }
    
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   PUT /api/documents/:id
// @desc    Mettre à jour un document
// @access  Private
router.put('/:id', auth, [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Le nom doit contenir entre 1 et 200 caractères'),
  body('category')
    .optional()
    .isIn(['contrat', 'diagnostic', 'facture', 'photo', 'plan', 'compromis', 'acte_vente', 'pret', 'assurance', 'expertise', 'correspondance', 'autre'])
    .withMessage('Catégorie invalide')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      });
    }

    const document = await Document.findById(req.params.id).populate('property');

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document non trouvé'
      });
    }

    // Vérifier que l'utilisateur possède la propriété
    if (document.property.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      });
    }

    // Mettre à jour les champs
    const { name, description, category, tags, notes, isImportant, expirationDate } = req.body;
    
    if (name !== undefined) document.name = name;
    if (description !== undefined) document.description = description;
    if (category !== undefined) document.category = category;
    if (tags !== undefined) document.tags = Array.isArray(tags) ? tags : tags.split(',').map(tag => tag.trim());
    if (notes !== undefined) document.notes = notes;
    if (isImportant !== undefined) document.isImportant = isImportant;
    if (expirationDate !== undefined) document.expirationDate = expirationDate;

    await document.save();

    res.json({
      success: true,
      message: 'Document mis à jour avec succès',
      data: { document }
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du document:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   GET /api/documents/:id/download
// @desc    Télécharger un document
// @access  Private
router.get('/:id/download', auth, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id).populate('property');

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document non trouvé'
      });
    }

    // Vérifier que l'utilisateur a accès à ce document
    const hasAccess = document.property.owner.toString() === req.user.id ||
                     document.sharedWith.some(share => share.user.toString() === req.user.id);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      });
    }

    // Vérifier que le fichier existe
    try {
      await fs.access(document.file.path);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Fichier non trouvé sur le serveur'
      });
    }

    // Incrémenter le compteur de téléchargements
    await document.incrementDownloadCount(req.user.id);

    // Envoyer le fichier
    res.setHeader('Content-Disposition', `attachment; filename="${document.file.originalName}"`);
    res.setHeader('Content-Type', document.file.mimeType);
    res.sendFile(path.resolve(document.file.path));
  } catch (error) {
    console.error('Erreur lors du téléchargement du document:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   GET /api/documents/:id/preview
// @desc    Prévisualiser un document (images et PDFs)
// @access  Private
router.get('/:id/preview', auth, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id).populate('property');

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document non trouvé'
      });
    }

    // Vérifier que l'utilisateur a accès à ce document
    const hasAccess = document.property.owner.toString() === req.user.id ||
                     document.sharedWith.some(share => share.user.toString() === req.user.id);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      });
    }

    // Vérifier que le document peut être prévisualisé
    if (!document.isImage && !document.isPDF) {
      return res.status(400).json({
        success: false,
        message: 'Ce type de document ne peut pas être prévisualisé'
      });
    }

    // Vérifier que le fichier existe
    try {
      await fs.access(document.file.path);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Fichier non trouvé sur le serveur'
      });
    }

    // Envoyer le fichier pour prévisualisation
    res.setHeader('Content-Type', document.file.mimeType);
    res.sendFile(path.resolve(document.file.path));
  } catch (error) {
    console.error('Erreur lors de la prévisualisation du document:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   DELETE /api/documents/:id
// @desc    Supprimer un document
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id).populate('property');

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document non trouvé'
      });
    }

    // Vérifier que l'utilisateur possède la propriété
    if (document.property.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      });
    }

    // Soft delete
    document.isActive = false;
    await document.save();

    res.json({
      success: true,
      message: 'Document supprimé avec succès'
    });
  } catch (error) {
    console.error('Erreur lors de la suppression du document:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   POST /api/documents/:id/share
// @desc    Partager un document avec un utilisateur
// @access  Private
router.post('/:id/share', auth, [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Email invalide'),
  body('permissions')
    .isIn(['view', 'download', 'edit'])
    .withMessage('Permissions invalides')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      });
    }

    const document = await Document.findById(req.params.id).populate('property');

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document non trouvé'
      });
    }

    // Vérifier que l'utilisateur possède la propriété
    if (document.property.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      });
    }

    const { email, permissions } = req.body;

    // Trouver l'utilisateur à partager
    const User = require('../models/User');
    const userToShare = await User.findOne({ email });

    if (!userToShare) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }

    // Vérifier si déjà partagé
    const existingShare = document.sharedWith.find(
      share => share.user.toString() === userToShare._id.toString()
    );

    if (existingShare) {
      existingShare.permissions = permissions;
    } else {
      document.sharedWith.push({
        user: userToShare._id,
        permissions
      });
    }

    await document.save();

    res.json({
      success: true,
      message: 'Document partagé avec succès',
      data: { document }
    });
  } catch (error) {
    console.error('Erreur lors du partage du document:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

module.exports = router;