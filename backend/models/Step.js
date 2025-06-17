const mongoose = require('mongoose');

const stepSchema = new mongoose.Schema({
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: [true, 'Propriété requise']
  },
  name: {
    type: String,
    required: [true, 'Nom de l\'étape requis'],
    trim: true,
    maxlength: [100, 'Le nom ne peut pas dépasser 100 caractères']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'La description ne peut pas dépasser 500 caractères']
  },
  category: {
    type: String,
    enum: [
      'recherche',
      'visite',
      'offre',
      'compromis',
      'financement',
      'diagnostics',
      'signature',
      'remise_cles',
      'autre'
    ],
    required: [true, 'Catégorie requise']
  },
  status: {
    type: String,
    enum: ['todo', 'in_progress', 'completed', 'cancelled', 'on_hold'],
    default: 'todo'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  order: {
    type: Number,
    required: [true, 'Ordre requis'],
    min: [1, 'L\'ordre doit être positif']
  },
  dates: {
    plannedStart: {
      type: Date
    },
    plannedEnd: {
      type: Date
    },
    actualStart: {
      type: Date
    },
    actualEnd: {
      type: Date
    },
    deadline: {
      type: Date
    }
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  contacts: [{
    name: {
      type: String,
      required: true,
      trim: true
    },
    role: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    phone: {
      type: String,
      trim: true
    }
  }],
  documents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document'
  }],
  checklist: [{
    item: {
      type: String,
      required: true,
      trim: true
    },
    completed: {
      type: Boolean,
      default: false
    },
    completedAt: {
      type: Date
    },
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    notes: {
      type: String,
      trim: true
    }
  }],
  costs: {
    estimated: {
      type: Number,
      min: [0, 'Le coût estimé doit être positif']
    },
    actual: {
      type: Number,
      min: [0, 'Le coût réel doit être positif']
    },
    currency: {
      type: String,
      default: 'EUR',
      enum: ['EUR', 'USD']
    }
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Les notes ne peuvent pas dépasser 1000 caractères']
  },
  reminders: [{
    date: {
      type: Date,
      required: true
    },
    message: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      enum: ['email', 'push', 'sms'],
      default: 'email'
    },
    sent: {
      type: Boolean,
      default: false
    },
    sentAt: {
      type: Date
    }
  }],
  dependencies: [{
    step: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Step'
    },
    type: {
      type: String,
      enum: ['blocks', 'triggers'],
      default: 'blocks'
    }
  }],
  isTemplate: {
    type: Boolean,
    default: false
  },
  templateCategory: {
    type: String,
    enum: ['achat_neuf', 'achat_ancien', 'investissement', 'premier_achat'],
    required: function() {
      return this.isTemplate;
    }
  },
  completionPercentage: {
    type: Number,
    min: [0, 'Le pourcentage doit être entre 0 et 100'],
    max: [100, 'Le pourcentage doit être entre 0 et 100'],
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index pour améliorer les performances
stepSchema.index({ property: 1, order: 1 });
stepSchema.index({ status: 1 });
stepSchema.index({ category: 1 });
stepSchema.index({ 'dates.deadline': 1 });
stepSchema.index({ assignedTo: 1 });
stepSchema.index({ isTemplate: 1, templateCategory: 1 });

// Virtual pour vérifier si l'étape est en retard
stepSchema.virtual('isOverdue').get(function() {
  if (!this.dates.deadline || this.status === 'completed') {
    return false;
  }
  return new Date() > this.dates.deadline;
});

// Virtual pour calculer la durée estimée
stepSchema.virtual('estimatedDuration').get(function() {
  if (this.dates.plannedStart && this.dates.plannedEnd) {
    return Math.ceil((this.dates.plannedEnd - this.dates.plannedStart) / (1000 * 60 * 60 * 24));
  }
  return null;
});

// Virtual pour calculer la durée réelle
stepSchema.virtual('actualDuration').get(function() {
  if (this.dates.actualStart && this.dates.actualEnd) {
    return Math.ceil((this.dates.actualEnd - this.dates.actualStart) / (1000 * 60 * 60 * 24));
  }
  return null;
});

// Virtual pour le pourcentage de la checklist complétée
stepSchema.virtual('checklistCompletion').get(function() {
  if (!this.checklist || this.checklist.length === 0) {
    return 100;
  }
  const completed = this.checklist.filter(item => item.completed).length;
  return Math.round((completed / this.checklist.length) * 100);
});

// Méthode pour marquer l'étape comme commencée
stepSchema.methods.start = function() {
  if (this.status === 'todo') {
    this.status = 'in_progress';
    this.dates.actualStart = new Date();
  }
  return this.save();
};

// Méthode pour marquer l'étape comme terminée
stepSchema.methods.complete = function() {
  this.status = 'completed';
  this.dates.actualEnd = new Date();
  this.completionPercentage = 100;
  return this.save();
};

// Méthode pour calculer le pourcentage de completion automatiquement
stepSchema.methods.updateCompletionPercentage = function() {
  const checklistPercent = this.checklistCompletion;
  
  if (this.status === 'completed') {
    this.completionPercentage = 100;
  } else if (this.status === 'in_progress') {
    this.completionPercentage = Math.max(checklistPercent, 10);
  } else {
    this.completionPercentage = 0;
  }
  
  return this.save();
};

// Middleware pour mettre à jour automatiquement le pourcentage
stepSchema.pre('save', function(next) {
  // Mise à jour automatique du pourcentage si pas défini manuellement
  if (this.isModified('checklist') || this.isModified('status')) {
    const checklistPercent = this.checklistCompletion;
    
    if (this.status === 'completed') {
      this.completionPercentage = 100;
    } else if (this.status === 'in_progress') {
      this.completionPercentage = Math.max(checklistPercent, 10);
    } else if (this.status === 'todo') {
      this.completionPercentage = 0;
    }
  }
  
  next();
});

module.exports = mongoose.model('Step', stepSchema);