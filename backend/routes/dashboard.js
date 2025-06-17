const express = require('express');
const Property = require('../models/Property');
const Step = require('../models/Step');
const Document = require('../models/Document');
const CalendarEvent = require('../models/Calendar');
const { auth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/dashboard/overview
// @desc    Obtenir une vue d'ensemble du tableau de bord
// @access  Private
router.get('/overview', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const next7Days = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
    const next30Days = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));

    // Filtre de base pour les propriétés de l'utilisateur
    const propertyFilter = {
      $or: [
        { owner: userId },
        { 'sharedWith.user': userId }
      ],
      isActive: true
    };

    // Statistiques des propriétés
    const [properties, propertiesByStatus] = await Promise.all([
      Property.find(propertyFilter).select('_id title status currentStep price'),
      Property.aggregate([
        { $match: propertyFilter },
        { $group: { _id: '$status', count: { $sum: 1 }, totalValue: { $sum: '$price.amount' } } }
      ])
    ]);

    const propertyIds = properties.map(p => p._id);

    // Statistiques des étapes
    const [totalSteps, stepsByStatus, overdueSteps, upcomingSteps] = await Promise.all([
      Step.countDocuments({ property: { $in: propertyIds }, isActive: true }),
      Step.aggregate([
        { $match: { property: { $in: propertyIds }, isActive: true } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Step.countDocuments({
        property: { $in: propertyIds },
        isActive: true,
        status: { $in: ['pending', 'in_progress'] },
        deadline: { $lt: now }
      }),
      Step.countDocuments({
        property: { $in: propertyIds },
        isActive: true,
        status: { $in: ['pending', 'in_progress'] },
        deadline: { $gte: now, $lte: next7Days }
      })
    ]);

    // Statistiques des documents
    const [totalDocuments, documentsByCategory, recentDocuments] = await Promise.all([
      Document.countDocuments({ property: { $in: propertyIds }, isActive: true }),
      Document.aggregate([
        { $match: { property: { $in: propertyIds }, isActive: true } },
        { $group: { _id: '$category', count: { $sum: 1 } } }
      ]),
      Document.countDocuments({
        property: { $in: propertyIds },
        isActive: true,
        createdAt: { $gte: startOfMonth }
      })
    ]);

    // Statistiques du calendrier
    const calendarFilter = {
      $or: [
        { owner: userId },
        { 'sharedWith.user': userId }
      ],
      isActive: true
    };

    const [upcomingEvents, overdueEvents, eventsThisMonth] = await Promise.all([
      CalendarEvent.countDocuments({
        ...calendarFilter,
        startDate: { $gte: now, $lte: next30Days },
        status: { $in: ['scheduled', 'confirmed'] }
      }),
      CalendarEvent.countDocuments({
        ...calendarFilter,
        endDate: { $lt: now },
        status: { $in: ['scheduled', 'confirmed'] }
      }),
      CalendarEvent.countDocuments({
        ...calendarFilter,
        startDate: { $gte: startOfMonth, $lte: endOfMonth }
      })
    ]);

    // Calcul des alertes et notifications
    const alerts = [];
    
    if (overdueSteps > 0) {
      alerts.push({
        type: 'warning',
        title: 'Étapes en retard',
        message: `Vous avez ${overdueSteps} étape(s) en retard`,
        count: overdueSteps,
        priority: 'high'
      });
    }

    if (upcomingSteps > 0) {
      alerts.push({
        type: 'info',
        title: 'Étapes à venir',
        message: `${upcomingSteps} étape(s) à réaliser dans les 7 prochains jours`,
        count: upcomingSteps,
        priority: 'medium'
      });
    }

    if (overdueEvents > 0) {
      alerts.push({
        type: 'error',
        title: 'Événements en retard',
        message: `${overdueEvents} événement(s) non traité(s)`,
        count: overdueEvents,
        priority: 'high'
      });
    }

    // Calcul de la progression globale
    const completedSteps = stepsByStatus.find(s => s._id === 'completed')?.count || 0;
    const globalProgress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    // Valeur totale du portefeuille
    const totalPortfolioValue = propertiesByStatus.reduce((sum, status) => sum + (status.totalValue || 0), 0);

    const overview = {
      properties: {
        total: properties.length,
        byStatus: propertiesByStatus.reduce((acc, item) => {
          acc[item._id] = { count: item.count, value: item.totalValue || 0 };
          return acc;
        }, {}),
        totalValue: totalPortfolioValue
      },
      steps: {
        total: totalSteps,
        completed: completedSteps,
        overdue: overdueSteps,
        upcoming: upcomingSteps,
        progress: globalProgress,
        byStatus: stepsByStatus.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      },
      documents: {
        total: totalDocuments,
        recent: recentDocuments,
        byCategory: documentsByCategory.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      },
      calendar: {
        upcomingEvents,
        overdueEvents,
        eventsThisMonth
      },
      alerts,
      summary: {
        activeProperties: properties.filter(p => ['recherche', 'visite', 'negociation', 'compromis', 'financement'].includes(p.status)).length,
        completedPurchases: properties.filter(p => p.status === 'cles_remises').length,
        totalInvestment: totalPortfolioValue,
        globalProgress
      }
    };

    res.json({
      success: true,
      data: { overview }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération du tableau de bord:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   GET /api/dashboard/recent-activity
// @desc    Obtenir l'activité récente
// @access  Private
router.get('/recent-activity', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 20;
    const days = parseInt(req.query.days) || 7;
    const since = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));

    const propertyFilter = {
      $or: [
        { owner: userId },
        { 'sharedWith.user': userId }
      ],
      isActive: true
    };

    const properties = await Property.find(propertyFilter).select('_id');
    const propertyIds = properties.map(p => p._id);

    // Activités récentes
    const [recentSteps, recentDocuments, recentEvents, recentProperties] = await Promise.all([
      Step.find({
        property: { $in: propertyIds },
        isActive: true,
        updatedAt: { $gte: since }
      })
      .sort({ updatedAt: -1 })
      .limit(limit / 4)
      .populate('property', 'title')
      .select('name status updatedAt property category'),

      Document.find({
        property: { $in: propertyIds },
        isActive: true,
        createdAt: { $gte: since }
      })
      .sort({ createdAt: -1 })
      .limit(limit / 4)
      .populate('property', 'title')
      .select('name category createdAt property type'),

      CalendarEvent.find({
        $or: [
          { owner: userId },
          { 'sharedWith.user': userId }
        ],
        isActive: true,
        createdAt: { $gte: since }
      })
      .sort({ createdAt: -1 })
      .limit(limit / 4)
      .populate('property', 'title')
      .select('title type createdAt property startDate'),

      Property.find({
        ...propertyFilter,
        createdAt: { $gte: since }
      })
      .sort({ createdAt: -1 })
      .limit(limit / 4)
      .select('title status createdAt address.city')
    ]);

    // Formater les activités
    const activities = [];

    recentSteps.forEach(step => {
      activities.push({
        type: 'step',
        action: 'updated',
        title: `Étape mise à jour: ${step.name}`,
        description: `Statut: ${step.status}`,
        property: step.property?.title,
        date: step.updatedAt,
        icon: 'task',
        category: step.category
      });
    });

    recentDocuments.forEach(doc => {
      activities.push({
        type: 'document',
        action: 'uploaded',
        title: `Document ajouté: ${doc.name}`,
        description: `Catégorie: ${doc.category}`,
        property: doc.property?.title,
        date: doc.createdAt,
        icon: 'document',
        category: doc.category
      });
    });

    recentEvents.forEach(event => {
      activities.push({
        type: 'event',
        action: 'created',
        title: `Événement créé: ${event.title}`,
        description: `Type: ${event.type}`,
        property: event.property?.title,
        date: event.createdAt,
        icon: 'calendar',
        category: event.type
      });
    });

    recentProperties.forEach(property => {
      activities.push({
        type: 'property',
        action: 'created',
        title: `Nouvelle propriété: ${property.title}`,
        description: `Ville: ${property.address?.city}`,
        property: property.title,
        date: property.createdAt,
        icon: 'home',
        category: property.status
      });
    });

    // Trier par date décroissante et limiter
    activities.sort((a, b) => new Date(b.date) - new Date(a.date));
    const limitedActivities = activities.slice(0, limit);

    res.json({
      success: true,
      data: { activities: limitedActivities }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération de l\'activité récente:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   GET /api/dashboard/progress
// @desc    Obtenir la progression détaillée par propriété
// @access  Private
router.get('/progress', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const propertyFilter = {
      $or: [
        { owner: userId },
        { 'sharedWith.user': userId }
      ],
      isActive: true
    };

    const properties = await Property.find(propertyFilter)
      .select('title status currentStep price address createdAt')
      .populate('currentStep', 'name category status')
      .sort({ createdAt: -1 });

    const progressData = await Promise.all(
      properties.map(async (property) => {
        const steps = await Step.find({
          property: property._id,
          isActive: true
        }).select('status category priority deadline');

        const totalSteps = steps.length;
        const completedSteps = steps.filter(s => s.status === 'completed').length;
        const inProgressSteps = steps.filter(s => s.status === 'in_progress').length;
        const overdueSteps = steps.filter(s => 
          ['pending', 'in_progress'].includes(s.status) && 
          s.deadline && 
          new Date(s.deadline) < new Date()
        ).length;

        const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

        // Prochaine étape critique
        const nextCriticalStep = steps.find(s => 
          s.status === 'pending' && 
          s.priority === 'high' &&
          s.deadline
        );

        return {
          property: {
            id: property._id,
            title: property.title,
            status: property.status,
            price: property.price,
            city: property.address?.city,
            createdAt: property.createdAt
          },
          currentStep: property.currentStep,
          progress: {
            percentage: progress,
            completed: completedSteps,
            inProgress: inProgressSteps,
            total: totalSteps,
            overdue: overdueSteps
          },
          nextCriticalStep: nextCriticalStep ? {
            name: nextCriticalStep.name,
            category: nextCriticalStep.category,
            deadline: nextCriticalStep.deadline
          } : null,
          alerts: {
            hasOverdue: overdueSteps > 0,
            hasUrgent: nextCriticalStep && 
              new Date(nextCriticalStep.deadline) <= new Date(Date.now() + (7 * 24 * 60 * 60 * 1000))
          }
        };
      })
    );

    res.json({
      success: true,
      data: { progress: progressData }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération de la progression:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// @route   GET /api/dashboard/analytics
// @desc    Obtenir les analyses et métriques avancées
// @access  Private
router.get('/analytics', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = '6months' } = req.query;

    // Calculer la période
    let startDate;
    switch (period) {
      case '1month':
        startDate = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
        break;
      case '3months':
        startDate = new Date(Date.now() - (90 * 24 * 60 * 60 * 1000));
        break;
      case '6months':
        startDate = new Date(Date.now() - (180 * 24 * 60 * 60 * 1000));
        break;
      case '1year':
        startDate = new Date(Date.now() - (365 * 24 * 60 * 60 * 1000));
        break;
      default:
        startDate = new Date(Date.now() - (180 * 24 * 60 * 60 * 1000));
    }

    const propertyFilter = {
      $or: [
        { owner: userId },
        { 'sharedWith.user': userId }
      ],
      isActive: true,
      createdAt: { $gte: startDate }
    };

    // Évolution des propriétés par mois
    const propertiesByMonth = await Property.aggregate([
      { $match: propertyFilter },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 },
          totalValue: { $sum: '$price.amount' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Temps moyen par étape
    const stepDurations = await Step.aggregate([
      {
        $match: {
          isActive: true,
          status: 'completed',
          actualStartDate: { $exists: true },
          actualEndDate: { $exists: true }
        }
      },
      {
        $addFields: {
          duration: {
            $divide: [
              { $subtract: ['$actualEndDate', '$actualStartDate'] },
              1000 * 60 * 60 * 24 // Convertir en jours
            ]
          }
        }
      },
      {
        $group: {
          _id: '$category',
          avgDuration: { $avg: '$duration' },
          minDuration: { $min: '$duration' },
          maxDuration: { $max: '$duration' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Taux de réussite par type d'événement
    const eventSuccessRate = await CalendarEvent.aggregate([
      {
        $match: {
          $or: [
            { owner: userId },
            { 'sharedWith.user': userId }
          ],
          isActive: true,
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$type',
          total: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          cancelled: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          }
        }
      },
      {
        $addFields: {
          successRate: {
            $multiply: [
              { $divide: ['$completed', '$total'] },
              100
            ]
          }
        }
      }
    ]);

    // Répartition des coûts par catégorie
    const costsByCategory = await Step.aggregate([
      {
        $match: {
          isActive: true,
          'costs.amount': { $gt: 0 }
        }
      },
      { $unwind: '$costs' },
      {
        $group: {
          _id: '$costs.category',
          totalAmount: { $sum: '$costs.amount' },
          count: { $sum: 1 },
          avgAmount: { $avg: '$costs.amount' }
        }
      },
      { $sort: { totalAmount: -1 } }
    ]);

    const analytics = {
      timeline: {
        propertiesByMonth: propertiesByMonth.map(item => ({
          period: `${item._id.year}-${String(item._id.month).padStart(2, '0')}`,
          properties: item.count,
          value: item.totalValue
        }))
      },
      performance: {
        stepDurations: stepDurations.map(item => ({
          category: item._id,
          avgDays: Math.round(item.avgDuration * 10) / 10,
          minDays: Math.round(item.minDuration * 10) / 10,
          maxDays: Math.round(item.maxDuration * 10) / 10,
          count: item.count
        })),
        eventSuccessRate: eventSuccessRate.map(item => ({
          type: item._id,
          total: item.total,
          completed: item.completed,
          cancelled: item.cancelled,
          successRate: Math.round(item.successRate * 10) / 10
        }))
      },
      costs: {
        byCategory: costsByCategory.map(item => ({
          category: item._id,
          total: item.totalAmount,
          count: item.count,
          average: Math.round(item.avgAmount * 100) / 100
        }))
      }
    };

    res.json({
      success: true,
      data: { analytics }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des analyses:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

module.exports = router;