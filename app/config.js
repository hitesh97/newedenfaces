require.config({
  paths: {
    'vendor': './vendor',
    'almond': 'vendor/almond',
    'underscore': 'vendor/lodash.underscore.min',
    'jquery': 'vendor/jquery.min',
    'backbone': 'vendor/backbone-min',
    'text': 'vendor/requirejs-text',
    'toastr': 'vendor/toastr.min',
    'magnific-popup': 'vendor/jquery.magnific-popup.min',
    'bootstrap-dropdown': 'vendor/bootstrap-dropdown',
    'chart': 'vendor/Chart.min'
  },

  shim: {
    'backbone': {
      deps: ['jquery', 'underscore'],
      exports: 'Backbone'
    },
    'magnific-popup': {
      deps: ['jquery']
    },
    'typeahead': {
      deps: ['jquery']
    },
    'bootstrap-dropdown': {
      deps: ['jquery']
    },
    'toastr': {
      deps: ['jquery']
    },
    'chart': {
      exports: 'Chart'
    }
  }
});
