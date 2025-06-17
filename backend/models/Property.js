const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Propriétaire requis']
  },
  title: {
    type: String,
    required: [true, 'Titre requis'],
    trim: true,
    maxlength: [100, 'Le titre ne peut pas dépasser 100 caractères']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'La description ne peut pas dépasser 1000 caractères']
  },
  address: {
    street: {
      type: String,
      required: [true, 'Adresse requise'],
      trim: true
    },
    city: {
      type: String,
      required: [true, 'Ville requise'],
      trim: true
    },
    postalCode: {
      type: String,
      required: [true, 'Code postal requis'],
      trim: true,
      match: [/^[0-9]{5}$/, 'Code postal invalide']
    },
    country: {
      type: String,
      default: 'France',
      trim: true
    },
    coordinates: {
      latitude: Number,
      longitude: Number
    }
  },
  price: {
    amount: {
      type: Number,
      required: [true, 'Prix requis'],
      min: [0, 'Le prix doit être positif']
    },
    currency: {
      type: String,
      default: 'EUR',
      enum: ['EUR', 'USD']
    },
    negotiated: {
      type: Boolean,
      default: false
    },
    finalPrice: {
      type: Number,
      min: [0, 'Le prix final doit être positif']
    }
  },
  details: {
    surface: {
      type: Number,
      required: [true, 'Surface requise'],
      min: [1, 'La surface doit être positive']
    },
    rooms: {
      type: Number,
      required: [true, 'Nombre de pièces requis'],
      min: [1, 'Le nombre de pièces doit être positif']
    },
    bedrooms: {
      type: Number,
      min: [0, 'Le nombre de chambres doit être positif']
    },
    bathrooms: {
      type: Number,
      min: [0, 'Le nombre de salles de bain doit être positif']
    },
    floor: {
      type: Number,
      min: [0, 'L\'étage doit être positif']
    },
    totalFloors: {
      type: Number,
      min: [1, 'Le nombre total d\'étages doit être positif']
    },
    elevator: {
      type: Boolean,
      default: false
    },
    parking: {
      type: Boolean,
      default: false
    },
    balcony: {
      type: Boolean,
      default: false
    },
    garden: {
      type: Boolean,
      default: false
    },
    yearBuilt: {
      type: Number,
      min: [1800, 'Année de construction invalide'],
      max: [new Date().getFullYear(), 'Année de construction invalide']
    },
    energyClass: {
      type: String,
      enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G', ''],
      default: ''
    }
  },
  condition: {
    type: String,
    enum: ['excellent', 'good', 'fair', 'poor', 'renovation_needed'],
    required: [true, 'État du bien requis']
  },
  photos: [{
    url: {
      type: String,
      required: true
    },
    caption: {
      type: String,
      trim: true
    },
    isPrimary: {
      type: Boolean,
      default: false
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  status: {
    type: String,
    enum: ['searching', 'visiting', 'offer_made', 'compromis_signed', 'loan_pending', 'final_signature', 'keys_received', 'cancelled'],
    default: 'searching'
  },
  currentStep: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Step'
  },
  agent: {
    name: {
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
    },
    agency: {
      type: String,
      trim: true
    }
  },
  notary: {
    name: {
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
    },
    office: {
      type: String,
      trim: true
    }
  },
  importantDates: {
    firstVisit: Date,
    offerDate: Date,
    compromisDate: Date,
    finalSignatureDate: Date,
    keyHandoverDate: Date
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [2000, 'Les notes ne peuvent pas dépasser 2000 caractères']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  sharedWith: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    role: {
      type: String,
      enum: ['viewer', 'editor'],
      default: 'viewer'
    },
    sharedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index pour améliorer les performances
propertySchema.index({ owner: 1, createdAt: -1 });
propertySchema.index({ status: 1 });
propertySchema.index({ 'address.city': 1 });
propertySchema.index({ 'price.amount': 1 });
propertySchema.index({ 'details.surface': 1 });

// Virtual pour l'adresse complète
propertySchema.virtual('fullAddress').get(function() {
  return `${this.address.street}, ${this.address.postalCode} ${this.address.city}`;
});

// Virtual pour le prix au m²
propertySchema.virtual('pricePerSquareMeter').get(function() {
  if (this.details.surface && this.price.amount) {
    return Math.round(this.price.amount / this.details.surface);
  }
  return null;
});

// Virtual pour la photo principale
propertySchema.virtual('primaryPhoto').get(function() {
  return this.photos.find(photo => photo.isPrimary) || this.photos[0] || null;
});

// Méthode pour calculer le pourcentage de progression
propertySchema.methods.getProgressPercentage = function() {
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
  return statusProgress[this.status] || 0;
};

// Middleware pour s'assurer qu'une seule photo est marquée comme principale
propertySchema.pre('save', function(next) {
  if (this.photos && this.photos.length > 0) {
    const primaryPhotos = this.photos.filter(photo => photo.isPrimary);
    if (primaryPhotos.length === 0) {
      this.photos[0].isPrimary = true;
    } else if (primaryPhotos.length > 1) {
      this.photos.forEach((photo, index) => {
        photo.isPrimary = index === 0;
      });
    }
  }
  next();
});

module.exports = mongoose.model('Property', propertySchema);