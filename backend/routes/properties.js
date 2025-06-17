const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Property = require('../models/Property');
const Step = require('../models/Step');
const { auth, authorize } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

const router = express.Router();

// Configuration de multer pour l'upload de photos
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = path.join(process.env.UPLOAD_PATH || './uploads', 'properties');
    try {
      await fs.mkdir(uploadPath, { recursive: true });
      cb(null, uploadPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `property-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
    files: 10
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Seules les images sont autorisées (JPEG, JPG, PNG, GIF, WebP)'));
    }
  }
});

// Validation pour la création/modification d'une propriété
const propertyValidation = [
  body('title')
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage('Le titre doit contenir entre 3 et 100 caractères'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('La description ne peut pas dépasser 1000 caractères'),
  body('address.street')
    .trim()
    .notEmpty()
    .withMessage('L\'adresse est requise'),
  body('address.city')
    .trim()
    .notEmpty()
    .withMessage('La ville est requise'),
  body('address.postalCode')
    .trim()
    .matches(/^[0-9]{5}$/)
    .withMessage('Code postal invalide (5 chiffres requis)'),
  body('price.amount')
    .isNumeric()
    .isFloat({ min: 0 })
    .withMessage('Le prix doit être un nombre positif'),
  body('details.surface')
    .isNumeric()
    .isFloat({ min: 1 })
    .withMessage('La surface doit être un nombre positif'),
  body('details.rooms')
    .isInt({ min: 1 })
    .withMessage('Le nombre de pièces doit être un entier positif'),
  body('condition')
    .isIn(['excellent', 'good', 'fair', 'poor', 'renovation_needed'])
    .withMessage('État du bien invalide')
];

// @route   GET /api/properties
// @desc    Obtenir toutes les propriétés de l'utilisateur
// @access  Private
router.get('/', auth, [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Le numéro de page doit être un entier positif'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('La limite doit être entre 1 et 100'),
  query('status')
    .optional()
    .isIn(['searching', 'visiting', 'offer_made', 'compromis_signed', 'loan_pending', 'final_signature', 'keys_received', 'cancelled'])
    .withMessage('Statut invalide'),
  query('sortBy')
    .optional()
    .isIn(['createdAt', 'price', 'surface', 'title'])
    .withMessage('Critère de tri invalide'),
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Ordre de tri invalide')
], async (req, res) => {
  try {
    // Vérifier les erreurs de validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Paramètres invalides',
        errors: errors.array()
      });
    }

    const {
      page = 1,
      limit = 10,
      status,
      city,
      minPrice,
      maxPrice,
      minSurface,
      maxSurface,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search
    } = req.query;

    // Construire le filtre
    const filter = { owner: req.user.id, isActive: true };
    
    if (status) filter.status = status;
    if (city) filter['address.city'] = new RegExp(city, 'i');
    if (minPrice) filter['price.amount'] = { ...filter['price.amount'], $gte: parseFloat(minPrice) };
    if (maxPrice) filter['price.amount'] = { ...filter['price.amount'], $lte: parseFloat(maxPrice) };
    if (minSurface) filter['details.surface'] = { ...filter['details.surface'], $gte: parseFloat(minSurface) };
    if (maxSurface) filter['details.surface'] = { ...filter['details.surface'], $lte: parseFloat(maxSurface) };
    
    if (search) {
      filter.$or = [
        { title: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') },
        { 'address.street': new RegExp(search, 'i') },
        { 'address.city': new RegExp(search, 'i') }
      ];
    }

    // Options de tri
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Exécuter la requête
    const [properties, total] = await Promise.all([
      Property.find(filter)
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .populate('currentStep', 'name status completionPercentage')
        .lean(),
      Property.countDocuments(filter)
    ]);

    // Ajouter les informations calculées
    const enrichedProperties = properties.map(property => ({
      ...property,
      progressPercentage: getProgressPercentage(property.status),
      pricePerSquareMeter: Math.round(property.price.amount / property.details.surface)
    }));

    res.json({
      success: true,
      data: {
        properties: enrichedProperties,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des propriétés:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   GET /api/properties/:id
// @desc    Obtenir une propriété spécifique
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      $or: [
        { owner: req.user.id },
        { 'sharedWith.user': req.user.id }
      ]
    })
    .populate('owner', 'firstName lastName email')
    .populate('currentStep')
    .populate('sharedWith.user', 'firstName lastName email');

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Propriété non trouvée'
      });
    }

    // Récupérer les étapes associées
    const steps = await Step.find({ property: property._id })
      .sort({ order: 1 })
      .populate('assignedTo', 'firstName lastName email');

    res.json({
      success: true,
      data: {
        property: {
          ...property.toObject(),
          progressPercentage: property.getProgressPercentage()
        },
        steps
      }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération de la propriété:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   POST /api/properties
// @desc    Créer une nouvelle propriété
// @access  Private
router.post('/', auth, upload.array('photos', 10), propertyValidation, async (req, res) => {
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

    const propertyData = {
      ...req.body,
      owner: req.user.id
    };

    // Traiter les photos uploadées
    if (req.files && req.files.length > 0) {
      propertyData.photos = req.files.map((file, index) => ({
        url: `/uploads/properties/${file.filename}`,
        caption: req.body.photoCaptions ? req.body.photoCaptions[index] : '',
        isPrimary: index === 0
      }));
    }

    const property = new Property(propertyData);
    await property.save();

    // Créer les étapes par défaut
    await createDefaultSteps(property._id);

    res.status(201).json({
      success: true,
      message: 'Propriété créée avec succès',
      data: {
        property: {
          ...property.toObject(),
          progressPercentage: property.getProgressPercentage()
        }
      }
    });
  } catch (error) {
    console.error('Erreur lors de la création de la propriété:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   PUT /api/properties/:id
// @desc    Mettre à jour une propriété
// @access  Private
router.put('/:id', auth, upload.array('newPhotos', 10), propertyValidation, async (req, res) => {
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

    const property = await Property.findOne({
      _id: req.params.id,
      owner: req.user.id
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Propriété non trouvée'
      });
    }

    // Mettre à jour les champs
    Object.assign(property, req.body);

    // Ajouter les nouvelles photos
    if (req.files && req.files.length > 0) {
      const newPhotos = req.files.map(file => ({
        url: `/uploads/properties/${file.filename}`,
        caption: '',
        isPrimary: property.photos.length === 0
      }));
      property.photos.push(...newPhotos);
    }

    await property.save();

    res.json({
      success: true,
      message: 'Propriété mise à jour avec succès',
      data: {
        property: {
          ...property.toObject(),
          progressPercentage: property.getProgressPercentage()
        }
      }
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour de la propriété:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   DELETE /api/properties/:id
// @desc    Supprimer une propriété
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      owner: req.user.id
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Propriété non trouvée'
      });
    }

    // Soft delete
    property.isActive = false;
    await property.save();

    res.json({
      success: true,
      message: 'Propriété supprimée avec succès'
    });
  } catch (error) {
    console.error('Erreur lors de la suppression de la propriété:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   PUT /api/properties/:id/status
// @desc    Mettre à jour le statut d'une propriété
// @access  Private
router.put('/:id/status', auth, [
  body('status')
    .isIn(['searching', 'visiting', 'offer_made', 'compromis_signed', 'loan_pending', 'final_signature', 'keys_received', 'cancelled'])
    .withMessage('Statut invalide')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Statut invalide',
        errors: errors.array()
      });
    }

    const property = await Property.findOne({
      _id: req.params.id,
      owner: req.user.id
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Propriété non trouvée'
      });
    }

    property.status = req.body.status;
    await property.save();

    res.json({
      success: true,
      message: 'Statut mis à jour avec succès',
      data: {
        property: {
          ...property.toObject(),
          progressPercentage: property.getProgressPercentage()
        }
      }
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du statut:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// Fonction utilitaire pour calculer le pourcentage de progression
function getProgressPercentage(status) {
  const statusProgress = {
    'searching': 10,
    'visiting': 20,
    'offer_made': 40,
    'compromis_signed': 60,
    'loan_pending': 75,
    'final_signature': 90,
    'keys_received': 100,
    'cancelled': 0
  };
  return statusProgress[status] || 0;
}

// Fonction pour créer les étapes par défaut
async function createDefaultSteps(propertyId) {
  const defaultSteps = [
    { name: 'Recherche active', category: 'recherche', order: 1 },
    { name: 'Première visite', category: 'visite', order: 2 },
    { name: 'Deuxième visite', category: 'visite', order: 3 },
    { name: 'Faire une offre', category: 'offre', order: 4 },
    { name: 'Négociation', category: 'offre', order: 5 },
    { name: 'Signature du compromis', category: 'compromis', order: 6 },
    { name: 'Demande de prêt', category: 'financement', order: 7 },
    { name: 'Diagnostics immobiliers', category: 'diagnostics', order: 8 },
    { name: 'Accord de prêt', category: 'financement', order: 9 },
    { name: 'Signature définitive', category: 'signature', order: 10 },
    { name: 'Remise des clés', category: 'remise_cles', order: 11 }
  ];

  const steps = defaultSteps.map(step => ({
    ...step,
    property: propertyId,
    status: step.order === 1 ? 'in_progress' : 'todo'
  }));

  await Step.insertMany(steps);
}

module.exports = router;