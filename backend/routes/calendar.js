const express = require('express');
const { body, validationResult, query } = require('express-validator');
const CalendarEvent = require('../models/Calendar');
const Property = require('../models/Property');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Validation pour les événements
const eventValidation = [
  body('title')
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Le titre doit contenir entre 3 et 200 caractères'),
  body('type')
    .isIn(['visite', 'rendez_vous_notaire', 'rendez_vous_banque', 'signature', 'remise_cles', 'expertise', 'diagnostic', 'reunion', 'appel', 'echeance', 'rappel', 'autre'])
    .withMessage('Type d\'événement invalide'),
  body('startDate')
    .isISO8601()
    .withMessage('Date de début invalide'),
  body('endDate')
    .isISO8601()
    .withMessage('Date de fin invalide')
    .custom((endDate, { req }) => {
      if (new Date(endDate) <= new Date(req.body.startDate)) {
        throw new Error('La date de fin doit être après la date de début');
      }
      return true;
    }),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'urgent'])
    .withMessage('Priorité invalide')
];

// @route   GET /api/calendar/events
// @desc    Obtenir tous les événements de l'utilisateur
// @access  Private
router.get('/events', auth, [
  query('start')
    .optional()
    .isISO8601()
    .withMessage('Date de début invalide'),
  query('end')
    .optional()
    .isISO8601()
    .withMessage('Date de fin invalide'),
  query('property')
    .optional()
    .isMongoId()
    .withMessage('ID de propriété invalide'),
  query('type')
    .optional()
    .isIn(['visite', 'rendez_vous_notaire', 'rendez_vous_banque', 'signature', 'remise_cles', 'expertise', 'diagnostic', 'reunion', 'appel', 'echeance', 'rappel', 'autre'])
    .withMessage('Type invalide')
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
      start,
      end,
      property,
      type,
      status,
      priority,
      page = 1,
      limit = 50
    } = req.query;

    // Construire le filtre
    const filter = {
      $or: [
        { owner: req.user.id },
        { 'sharedWith.user': req.user.id }
      ],
      isActive: true
    };

    // Filtres de date
    if (start || end) {
      filter.startDate = {};
      if (start) filter.startDate.$gte = new Date(start);
      if (end) filter.startDate.$lte = new Date(end);
    }

    // Autres filtres
    if (property) filter.property = property;
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (priority) filter.priority = priority;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Exécuter la requête
    const [events, total] = await Promise.all([
      CalendarEvent.find(filter)
        .sort({ startDate: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('property', 'title address')
        .populate('step', 'name category')
        .populate('owner', 'firstName lastName email')
        .populate('documents', 'name type category')
        .lean(),
      CalendarEvent.countDocuments(filter)
    ]);

    // Enrichir les événements avec des informations calculées
    const enrichedEvents = events.map(event => ({
      ...event,
      isPast: new Date() > new Date(event.endDate),
      isOngoing: new Date() >= new Date(event.startDate) && new Date() <= new Date(event.endDate),
      isUpcoming: new Date() < new Date(event.startDate)
    }));

    res.json({
      success: true,
      data: {
        events: enrichedEvents,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des événements:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   GET /api/calendar/events/:id
// @desc    Obtenir un événement spécifique
// @access  Private
router.get('/events/:id', auth, async (req, res) => {
  try {
    const event = await CalendarEvent.findById(req.params.id)
      .populate('property', 'title address owner')
      .populate('step', 'name category status')
      .populate('owner', 'firstName lastName email')
      .populate('documents')
      .populate('sharedWith.user', 'firstName lastName email');

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Événement non trouvé'
      });
    }

    // Vérifier que l'utilisateur a accès à cet événement
    const hasAccess = event.owner._id.toString() === req.user.id ||
                     event.sharedWith.some(share => share.user._id.toString() === req.user.id);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      });
    }

    res.json({
      success: true,
      data: { event }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération de l\'événement:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   POST /api/calendar/events
// @desc    Créer un nouvel événement
// @access  Private
router.post('/events', auth, eventValidation, async (req, res) => {
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

    // Si une propriété est spécifiée, vérifier que l'utilisateur y a accès
    if (req.body.property) {
      const property = await Property.findOne({
        _id: req.body.property,
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
    }

    const eventData = {
      ...req.body,
      owner: req.user.id,
      createdBy: req.user.id
    };

    const event = new CalendarEvent(eventData);
    await event.save();

    await event.populate('property', 'title address');
    await event.populate('step', 'name category');

    res.status(201).json({
      success: true,
      message: 'Événement créé avec succès',
      data: { event }
    });
  } catch (error) {
    console.error('Erreur lors de la création de l\'événement:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   PUT /api/calendar/events/:id
// @desc    Mettre à jour un événement
// @access  Private
router.put('/events/:id', auth, eventValidation, async (req, res) => {
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

    const event = await CalendarEvent.findById(req.params.id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Événement non trouvé'
      });
    }

    // Vérifier que l'utilisateur peut modifier cet événement
    if (event.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      });
    }

    // Mettre à jour les champs
    Object.assign(event, req.body);
    event.lastModifiedBy = req.user.id;
    
    await event.save();

    await event.populate('property', 'title address');
    await event.populate('step', 'name category');

    res.json({
      success: true,
      message: 'Événement mis à jour avec succès',
      data: { event }
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour de l\'événement:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   PUT /api/calendar/events/:id/status
// @desc    Mettre à jour le statut d'un événement
// @access  Private
router.put('/events/:id/status', auth, [
  body('status')
    .isIn(['scheduled', 'confirmed', 'completed', 'cancelled', 'postponed'])
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

    const event = await CalendarEvent.findById(req.params.id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Événement non trouvé'
      });
    }

    // Vérifier que l'utilisateur a accès à cet événement
    const hasAccess = event.owner.toString() === req.user.id ||
                     event.sharedWith.some(share => share.user.toString() === req.user.id);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      });
    }

    const { status, outcome } = req.body;

    if (status === 'completed') {
      await event.complete(outcome);
    } else {
      event.status = status;
      await event.save();
    }

    res.json({
      success: true,
      message: 'Statut mis à jour avec succès',
      data: { event }
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du statut:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   POST /api/calendar/events/:id/postpone
// @desc    Reporter un événement
// @access  Private
router.post('/events/:id/postpone', auth, [
  body('newStartDate')
    .isISO8601()
    .withMessage('Nouvelle date de début invalide'),
  body('newEndDate')
    .optional()
    .isISO8601()
    .withMessage('Nouvelle date de fin invalide')
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

    const event = await CalendarEvent.findById(req.params.id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Événement non trouvé'
      });
    }

    // Vérifier que l'utilisateur peut modifier cet événement
    if (event.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      });
    }

    const { newStartDate, newEndDate } = req.body;

    await event.postpone(new Date(newStartDate), newEndDate ? new Date(newEndDate) : null);

    res.json({
      success: true,
      message: 'Événement reporté avec succès',
      data: { event }
    });
  } catch (error) {
    console.error('Erreur lors du report de l\'événement:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   DELETE /api/calendar/events/:id
// @desc    Supprimer un événement
// @access  Private
router.delete('/events/:id', auth, async (req, res) => {
  try {
    const event = await CalendarEvent.findById(req.params.id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Événement non trouvé'
      });
    }

    // Vérifier que l'utilisateur peut supprimer cet événement
    if (event.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      });
    }

    // Soft delete
    event.isActive = false;
    await event.save();

    res.json({
      success: true,
      message: 'Événement supprimé avec succès'
    });
  } catch (error) {
    console.error('Erreur lors de la suppression de l\'événement:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   GET /api/calendar/upcoming
// @desc    Obtenir les prochains événements
// @access  Private
router.get('/upcoming', auth, [
  query('days')
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage('Le nombre de jours doit être entre 1 et 365')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Paramètres invalides',
        errors: errors.array()
      });
    }

    const days = parseInt(req.query.days) || 7;
    const now = new Date();
    const endDate = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000));

    const events = await CalendarEvent.find({
      $or: [
        { owner: req.user.id },
        { 'sharedWith.user': req.user.id }
      ],
      isActive: true,
      startDate: {
        $gte: now,
        $lte: endDate
      },
      status: { $in: ['scheduled', 'confirmed'] }
    })
    .sort({ startDate: 1 })
    .limit(20)
    .populate('property', 'title address')
    .populate('step', 'name category');

    res.json({
      success: true,
      data: { events }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des événements à venir:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   GET /api/calendar/overdue
// @desc    Obtenir les événements en retard
// @access  Private
router.get('/overdue', auth, async (req, res) => {
  try {
    const now = new Date();

    const events = await CalendarEvent.find({
      $or: [
        { owner: req.user.id },
        { 'sharedWith.user': req.user.id }
      ],
      isActive: true,
      endDate: { $lt: now },
      status: { $in: ['scheduled', 'confirmed'] }
    })
    .sort({ startDate: -1 })
    .limit(50)
    .populate('property', 'title address')
    .populate('step', 'name category');

    res.json({
      success: true,
      data: { events }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des événements en retard:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   GET /api/calendar/stats
// @desc    Obtenir les statistiques du calendrier
// @access  Private
router.get('/stats', auth, async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const next7Days = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

    const filter = {
      $or: [
        { owner: req.user.id },
        { 'sharedWith.user': req.user.id }
      ],
      isActive: true
    };

    const [totalEvents, thisMonth, upcoming, overdue, byType, byStatus] = await Promise.all([
      CalendarEvent.countDocuments(filter),
      CalendarEvent.countDocuments({
        ...filter,
        startDate: { $gte: startOfMonth, $lte: endOfMonth }
      }),
      CalendarEvent.countDocuments({
        ...filter,
        startDate: { $gte: now, $lte: next7Days },
        status: { $in: ['scheduled', 'confirmed'] }
      }),
      CalendarEvent.countDocuments({
        ...filter,
        endDate: { $lt: now },
        status: { $in: ['scheduled', 'confirmed'] }
      }),
      CalendarEvent.aggregate([
        { $match: filter },
        { $group: { _id: '$type', count: { $sum: 1 } } }
      ]),
      CalendarEvent.aggregate([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ])
    ]);

    const stats = {
      total: totalEvents,
      thisMonth,
      upcoming,
      overdue,
      byType: byType.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      byStatus: byStatus.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {})
    };

    res.json({
      success: true,
      data: { stats }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

module.exports = router;