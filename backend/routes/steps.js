const express = require('express');
const { body, validationResult } = require('express-validator');
const Step = require('../models/Step');
const Property = require('../models/Property');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Validation pour les étapes
const stepValidation = [
  body('name')
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage('Le nom doit contenir entre 3 et 100 caractères'),
  body('category')
    .isIn(['recherche', 'visite', 'offre', 'compromis', 'financement', 'diagnostics', 'signature', 'remise_cles', 'autre'])
    .withMessage('Catégorie invalide'),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'urgent'])
    .withMessage('Priorité invalide'),
  body('order')
    .isInt({ min: 1 })
    .withMessage('L\'ordre doit être un entier positif')
];

// @route   GET /api/steps/property/:propertyId
// @desc    Obtenir toutes les étapes d'une propriété
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

    const steps = await Step.find({ 
      property: req.params.propertyId,
      isActive: true 
    })
    .sort({ order: 1 })
    .populate('assignedTo', 'firstName lastName email')
    .populate('documents', 'name type category uploadedAt');

    // Calculer les statistiques
    const stats = {
      total: steps.length,
      completed: steps.filter(step => step.status === 'completed').length,
      inProgress: steps.filter(step => step.status === 'in_progress').length,
      todo: steps.filter(step => step.status === 'todo').length,
      overdue: steps.filter(step => step.isOverdue).length
    };

    res.json({
      success: true,
      data: {
        steps,
        stats
      }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des étapes:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   GET /api/steps/:id
// @desc    Obtenir une étape spécifique
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const step = await Step.findById(req.params.id)
      .populate('property', 'title owner')
      .populate('assignedTo', 'firstName lastName email')
      .populate('documents')
      .populate('dependencies.step', 'name status');

    if (!step) {
      return res.status(404).json({
        success: false,
        message: 'Étape non trouvée'
      });
    }

    // Vérifier que l'utilisateur a accès à cette étape
    if (step.property.owner.toString() !== req.user.id) {
      const property = await Property.findOne({
        _id: step.property._id,
        'sharedWith.user': req.user.id
      });
      
      if (!property) {
        return res.status(403).json({
          success: false,
          message: 'Accès refusé'
        });
      }
    }

    res.json({
      success: true,
      data: { step }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération de l\'étape:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   POST /api/steps
// @desc    Créer une nouvelle étape
// @access  Private
router.post('/', auth, [
  body('property')
    .isMongoId()
    .withMessage('ID de propriété invalide'),
  ...stepValidation
], async (req, res) => {
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

    // Vérifier que l'ordre n'est pas déjà utilisé
    const existingStep = await Step.findOne({
      property: req.body.property,
      order: req.body.order,
      isActive: true
    });

    if (existingStep) {
      return res.status(400).json({
        success: false,
        message: 'Une étape avec cet ordre existe déjà'
      });
    }

    const step = new Step(req.body);
    await step.save();

    await step.populate('assignedTo', 'firstName lastName email');

    res.status(201).json({
      success: true,
      message: 'Étape créée avec succès',
      data: { step }
    });
  } catch (error) {
    console.error('Erreur lors de la création de l\'étape:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   PUT /api/steps/:id
// @desc    Mettre à jour une étape
// @access  Private
router.put('/:id', auth, stepValidation, async (req, res) => {
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

    const step = await Step.findById(req.params.id).populate('property');

    if (!step) {
      return res.status(404).json({
        success: false,
        message: 'Étape non trouvée'
      });
    }

    // Vérifier que l'utilisateur possède la propriété
    if (step.property.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      });
    }

    // Mettre à jour les champs
    Object.assign(step, req.body);
    await step.save();

    await step.populate('assignedTo', 'firstName lastName email');

    res.json({
      success: true,
      message: 'Étape mise à jour avec succès',
      data: { step }
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour de l\'étape:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   PUT /api/steps/:id/status
// @desc    Mettre à jour le statut d'une étape
// @access  Private
router.put('/:id/status', auth, [
  body('status')
    .isIn(['todo', 'in_progress', 'completed', 'cancelled', 'on_hold'])
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

    const step = await Step.findById(req.params.id).populate('property');

    if (!step) {
      return res.status(404).json({
        success: false,
        message: 'Étape non trouvée'
      });
    }

    // Vérifier que l'utilisateur a accès à cette étape
    if (step.property.owner.toString() !== req.user.id) {
      const property = await Property.findOne({
        _id: step.property._id,
        'sharedWith.user': req.user.id
      });
      
      if (!property) {
        return res.status(403).json({
          success: false,
          message: 'Accès refusé'
        });
      }
    }

    const { status } = req.body;
    const oldStatus = step.status;

    // Utiliser les méthodes du modèle pour les changements de statut
    if (status === 'in_progress' && oldStatus === 'todo') {
      await step.start();
    } else if (status === 'completed') {
      await step.complete();
    } else {
      step.status = status;
      await step.save();
    }

    res.json({
      success: true,
      message: 'Statut mis à jour avec succès',
      data: { step }
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du statut:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   PUT /api/steps/:id/checklist
// @desc    Mettre à jour la checklist d'une étape
// @access  Private
router.put('/:id/checklist', auth, [
  body('checklist')
    .isArray()
    .withMessage('La checklist doit être un tableau'),
  body('checklist.*.item')
    .trim()
    .notEmpty()
    .withMessage('L\'élément de la checklist ne peut pas être vide')
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

    const step = await Step.findById(req.params.id).populate('property');

    if (!step) {
      return res.status(404).json({
        success: false,
        message: 'Étape non trouvée'
      });
    }

    // Vérifier que l'utilisateur a accès à cette étape
    if (step.property.owner.toString() !== req.user.id) {
      const property = await Property.findOne({
        _id: step.property._id,
        'sharedWith.user': req.user.id
      });
      
      if (!property) {
        return res.status(403).json({
          success: false,
          message: 'Accès refusé'
        });
      }
    }

    // Mettre à jour la checklist
    step.checklist = req.body.checklist.map(item => ({
      ...item,
      completedAt: item.completed ? new Date() : null,
      completedBy: item.completed ? req.user.id : null
    }));

    await step.save();

    res.json({
      success: true,
      message: 'Checklist mise à jour avec succès',
      data: { 
        step,
        checklistCompletion: step.checklistCompletion
      }
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour de la checklist:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   POST /api/steps/:id/checklist-item
// @desc    Ajouter un élément à la checklist
// @access  Private
router.post('/:id/checklist-item', auth, [
  body('item')
    .trim()
    .notEmpty()
    .withMessage('L\'élément ne peut pas être vide')
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

    const step = await Step.findById(req.params.id).populate('property');

    if (!step) {
      return res.status(404).json({
        success: false,
        message: 'Étape non trouvée'
      });
    }

    // Vérifier que l'utilisateur possède la propriété
    if (step.property.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      });
    }

    step.checklist.push({
      item: req.body.item,
      completed: false,
      notes: req.body.notes || ''
    });

    await step.save();

    res.json({
      success: true,
      message: 'Élément ajouté à la checklist',
      data: { step }
    });
  } catch (error) {
    console.error('Erreur lors de l\'ajout à la checklist:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   DELETE /api/steps/:id
// @desc    Supprimer une étape
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const step = await Step.findById(req.params.id).populate('property');

    if (!step) {
      return res.status(404).json({
        success: false,
        message: 'Étape non trouvée'
      });
    }

    // Vérifier que l'utilisateur possède la propriété
    if (step.property.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      });
    }

    // Soft delete
    step.isActive = false;
    await step.save();

    res.json({
      success: true,
      message: 'Étape supprimée avec succès'
    });
  } catch (error) {
    console.error('Erreur lors de la suppression de l\'étape:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   POST /api/steps/reorder
// @desc    Réorganiser l'ordre des étapes
// @access  Private
router.post('/reorder', auth, [
  body('propertyId')
    .isMongoId()
    .withMessage('ID de propriété invalide'),
  body('steps')
    .isArray()
    .withMessage('Les étapes doivent être un tableau'),
  body('steps.*.id')
    .isMongoId()
    .withMessage('ID d\'étape invalide'),
  body('steps.*.order')
    .isInt({ min: 1 })
    .withMessage('L\'ordre doit être un entier positif')
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

    const { propertyId, steps } = req.body;

    // Vérifier que l'utilisateur possède la propriété
    const property = await Property.findOne({
      _id: propertyId,
      owner: req.user.id
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Propriété non trouvée'
      });
    }

    // Mettre à jour l'ordre des étapes
    const updatePromises = steps.map(({ id, order }) => 
      Step.findByIdAndUpdate(id, { order }, { new: true })
    );

    await Promise.all(updatePromises);

    // Récupérer les étapes mises à jour
    const updatedSteps = await Step.find({ 
      property: propertyId,
      isActive: true 
    }).sort({ order: 1 });

    res.json({
      success: true,
      message: 'Ordre des étapes mis à jour avec succès',
      data: { steps: updatedSteps }
    });
  } catch (error) {
    console.error('Erreur lors de la réorganisation des étapes:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

module.exports = router;