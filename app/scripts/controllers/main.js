/* global ga moment multiDownload */

'use strict';

/**
 * @ngdoc function
 * @name dauriaSearchApp.controller:MainCtrl
 * @description
 * # MainCtrl
 * Controller of the dauriaSearchApp
 */
angular.module('dauriaSearchApp')
  .controller('MainCtrl', ['$scope', '$filter', 'leafletData', 'leafletBoundsHelpers', '$http', '$sce', '$q', '$modal', function($scope, $filter, leafletData, leafletBoundsHelpers, $http, $sce, $q, $modal) {

    // array of everything returned from api calls
    $scope.results = [];

    // api endpoint and canceller
    var endpoint = 'https://api.developmentseed.org/satellites';
    var canceller = $q.defer();

    //NEW_ERA: новое АПИ для поиска
    const NEW_ERA_ENDPOINT = 'https://sat-api.developmentseed.org/stac/search';



    // Cloud coverage.
    $scope.cloudCoverageMin = 0;
    $scope.cloudCoverageMax = 20;
    // Sun azimuth.
    $scope.sunAzimuthMin = 0;
    $scope.sunAzimuthMax = 180;
    // Date range.
    // Default date is from 'now' to 'now - 6 months'
    var dateEnd = moment(),
        dateStart = moment().subtract(6, 'months'),
        dateStartStr = dateStart.format('YYYY-MM-DD'),
        dateEndStr = dateEnd.format('YYYY-MM-DD');

    $scope.dateRangeStart = dateStartStr;
    $scope.dateRangeEnd = dateEndStr;

    // Temporary date range variables for display reasons
    $scope.dateRangeStartTemp = $scope.dateRangeStart;
    $scope.dateRangeEndTemp = $scope.dateRangeEnd;

    // Sorting.
    $scope.sortField = 'acquisitionDate';
    $scope.sortReverse = true;

    // Store selected result.
    $scope.selectedResult = null;

    // Store parameter for filtering based on map clicks
    $scope.rowPathSelect = null;

    // Store parameter for opened filter panes
    $scope.openFilter = null;

    // d3 parameters for multiple uses
    var brush = {},
    graphParam =  {
      margin: {
        top: 10,
        right: 40,
        bottom: 30,
        left: 40
      }
    };

    // spinner parameters
    var opts = {
      lines: 13, // The number of lines to draw
      length: 10, // The length of each line
      width: 4, // The line thickness
      radius: 16, // The radius of the inner circle
      corners: 0, // Corner roundness (0..1)
      color: '#231850', // #rgb or #rrggbb or array of colors
      speed: 0.7, // Rounds per second
      trail: 60, // Afterglow percentage
    };
    var target = document.getElementById('spinner');
    $scope.spinner = new Spinner(opts);

    var bounds = leafletBoundsHelpers.createBoundsFromArray([
      [ 90, -180 ],
      [ -90, 180 ]
    ]);

    $scope.defaults = {
      tileLayer: 'https://api.tiles.mapbox.com/v4/nate.kna67bkd/{z}/{x}/{y}.png?access_token=pk.eyJ1IjoiZGV2c2VlZCIsImEiOiJnUi1mbkVvIn0.018aLhX0Mb0tdtaT2QNe2Q',
      maxZoom: 14
    };

    $scope.safeApply = function(fn) {
      var phase = this.$root.$$phase;
      if(phase === '$apply' || phase === '$digest') {
        if(fn && (typeof(fn) === 'function')) {
          fn();
        }
      } else {
        this.$apply(fn);
      }
    };

    angular.extend($scope, {
      bounds: bounds,
      center: { lat: 1, lng: 1, zoom: 2 }, // show global to start
      markers: {},
      events: {
        markers: {
          enable: ['mouseover', 'mouseout']
        }
      },
      paths: {}
    });

    // Get starting center to see if the user has moved map and
    // disable auto-centering if so #36
    var startingCenter = $scope.center;
    var userHasMoved = function () {
      return ($scope.center !== startingCenter);
    };

    // For keeping some stuff clean until after the first zoom
    $scope.firstZoomDone = false;

    ////Move to user's IP location, fall back to east of San Fran
    ////NEW_ERA: ставим Башкортостан по центру экрана вместо Сан-Франциско
    // var demoCenter = { lat: 54.5, lng: 56.5, zoom: 7 };
    // $http.get('https://vast-coast-1838.herokuapp.com/location')
    //   .success(function(data) {
    //     // Do nothing if the user has already moved their location
    //     if (userHasMoved()) { return;}

    //     // We got a response, make sure we have lat/lon and set it
    //     if (data && data.location && data.location.lat && data.location.lon) {
    //       $scope.center = {
    //         lat: parseFloat(data.location.lat),
    //         lng: parseFloat(data.location.lon),
    //         zoom: 6
    //       }; // Centered on browser's IP
    //       setTimeout(function(){ $scope.firstZoomDone = true; },500);
    //     } else {
    //       // Do nothing if the user has already moved their location
    //       if (userHasMoved()) { return; }
    //       $scope.center = demoCenter; // centered on east of San Francisco
    //       setTimeout(function(){ $scope.firstZoomDone = true; },500);
    //     }
    //   }).
    //   error(function() {
    //     $scope.center = demoCenter; // centered on east of San Francisco
    //     setTimeout(function(){ $scope.firstZoomDone = true; },500);
    //   });

    $scope.$watchGroup(['bounds','dateRangeStart','dateRangeEnd'], function() {
      $scope.cleanPaths();
      $scope.execQuery();
    });

    $scope.$watchGroup(['cloudCoverageMin', 'cloudCoverageMax', 'sunAzimuthMin', 'sunAzimuthMax'], function() {
      $scope.markers = {};
      updateMarkers();
    });

    $scope.$watch('openFilter', function() {
      // this will make all tests fail so we should fix in the future
      $scope.$apply();
      $scope.switchOpenFilter();
    });

    /**
     * Show the info pane with a message or hide it if no message given
     *
     * @param {String} msg
     */
    var setInfoPane = function (msg) {
      if (msg === undefined || msg === '' || $scope.firstZoomDone === false) {
        $scope.showInfoPane = false;
        $scope.infoPaneMessage = '';
      } else {
        $scope.infoPaneMessage = msg;
        $scope.showInfoPane = true;
      }
    };


    // NEW_ERA: адаптер, чтобы из данных нового API получить старые аналоги
    $scope.NEW_ERA_ADAPTER_FOR_SCENE_RESULTS = function(sceneOfNewApi) {
      let scene = {};

      scene.acquisitionDate = new Date(sceneOfNewApi.properties.datetime).toISOString().slice(0,10);
      scene.sceneID = sceneOfNewApi.properties["landsat:scene_id"];
      scene.product_id = sceneOfNewApi.properties["landsat:product_id"];
      scene.row = sceneOfNewApi.properties["eo:row"];
      scene.path = sceneOfNewApi.properties["eo:column"];;
      scene.className = `${scene.sceneID}-${scene.row}-${scene.path}`;

      let sceneCenterLongitude = (sceneOfNewApi.bbox[0] + sceneOfNewApi.bbox[2]) / 2;
      let sceneCenterLatitude = (sceneOfNewApi.bbox[1] + sceneOfNewApi.bbox[3]) / 2;

      scene.sceneCenterLatitude = sceneCenterLatitude;
      scene.lat = scene.sceneCenterLatitude;

      scene.sceneCenterLongitude = sceneCenterLongitude;
      if (scene.sceneCenterLongitude > 0) {
        scene.lng = scene.sceneCenterLongitude + Math.floor(($scope.bounds.southWest.lng + 180) / 360) * 360;
      }
      else {
        scene.lng = scene.sceneCenterLongitude + Math.floor(($scope.bounds.northEast.lng + 180) / 360) * 360;
      }

      scene.upperLeftCornerLongitude = sceneOfNewApi.geometry.coordinates[0][0][0];
      scene.upperLeftCornerLatitude = sceneOfNewApi.geometry.coordinates[0][0][1];

      scene.upperRightCornerLongitude = sceneOfNewApi.geometry.coordinates[0][1][0];
      scene.upperRightCornerLatitude = sceneOfNewApi.geometry.coordinates[0][1][1];

      scene.lowerRightCornerLongitude = sceneOfNewApi.geometry.coordinates[0][2][0];
      scene.lowerRightCornerLatitude = sceneOfNewApi.geometry.coordinates[0][2][1];

      scene.lowerLeftCornerLongitude = sceneOfNewApi.geometry.coordinates[0][3][0];
      scene.lowerLeftCornerLatitude = sceneOfNewApi.geometry.coordinates[0][3][1];


      scene.cloud_coverage = sceneOfNewApi.properties["eo:cloud_cover"];
      scene.cloudCoverFull = scene.cloud_coverage;
      scene.sunAzimuth = sceneOfNewApi.properties["eo:sun_azimuth"];

      scene.icon = {};
      scene.icon.type = 'div';
      scene.icon.className = 'map-icon text-center';

      scene.aws_thumbnail = sceneOfNewApi.assets.thumbnail.href;

      scene.downloadURL = 'https://storage.googleapis.com/earthengine-public/landsat/L8/' + zeroPad(scene.path, 3) + '/' + zeroPad(scene.row, 3) + '/' + scene.sceneID + '.tar.bz';

      return scene;
    }

    // NEW_ERA: запросы к новому АПИ
    $scope.execQuery = function () {
      // cancel any existing requests and renew canceller
      canceller.resolve();
      canceller = $q.defer();

      // spin!
      $scope.spinner.spin(target);

      // no satellite gif
      $scope.satellite = false;

      // check continuity of longitude range (bool)
      var continuous = Math.floor(($scope.bounds.northEast.lng + 180) / 360) === Math.floor(($scope.bounds.southWest.lng + 180) / 360);

      $scope.searchString = NEW_ERA_QUERY_CONSTRUCTOR({
        dateRange: [$scope.dateRangeStart, $scope.dateRangeEnd],
        limit: 500,
        sceneCenterLatRange: [$scope.bounds.northEast.lat, $scope.bounds.southWest.lat],
        // mod function here supports negative modulo in the 'expected fashion'
        // we are treating the longitude this way to support multiple rotations around the earth
        sceneCenterLonRange: [mod($scope.bounds.northEast.lng + 180, 360) - 180, mod($scope.bounds.southWest.lng + 180, 360) - 180],
        continuous: continuous
      });

      const finalQueryStr = `${NEW_ERA_ENDPOINT}${$scope.searchString}`;
      console.log("Итоговая строка запроса для АПИ: ", finalQueryStr)

      $http.get(finalQueryStr, { timeout: canceller.promise })
        .success(function (data) {
          setInfoPane(); // Hide info pane so it doesn't flash when results are redrawn

          console.log("Выполнили запрос по НОВОМУ АПИ и получили результат:", data);

          let total = data.meta.found;
          const results = data.features;
          const resultLength = results.length;
          $scope.results = [];
          $scope.markers = {};

          // clear histograms
          d3.select('.cloudCoverSlider svg').selectAll('.bar').remove();
          d3.select('.sunAzimuthSlider svg').selectAll('.bar').remove();

          if (total < 3000) {
            for (let i = 0; i < resultLength; i++) {
              const scene = $scope.NEW_ERA_ADAPTER_FOR_SCENE_RESULTS(results[i]);

              $scope.results.push(scene);
            }

            updateMarkers();

            if ($scope.openFilter === 'cloud' || $scope.openFilter === 'sun') {
              var helperNames = ($scope.openFilter === 'cloud') ? { main: 'cloudCover', val: 'cloud_coverage', bound: 100, bin: 20 } : { main: 'sunAzimuth', val: 'sunAzimuth', bound: 180, bin: 36 };
              var vals = $scope.results.map(function (result) { return Math.max(result[helperNames.val], 0); });
              if ($scope.openFilter === 'sun') {
                vals = vals.filter(function (sun) { return sun > 0; });
              }
              var size = getSize($scope.openFilter);
              $scope.updateHistogram('.' + helperNames.main + 'Slider', vals, [0, helperNames.bound], helperNames.bin, size);
            }

          }
          else {
            // Not showing anything because we have too many results, let user know
            var msg = 'Слишком много данных, чтобы отобразить их на карте!<br/><br/>' +
              'Попробуйте приблизиться к области интереса или уменьшить диапазон даты.';
            setInfoPane(msg); // Show helpful message
            // also clear paths and rowPath selection and selectedResult because why not
            $scope.paths = {};
            $scope.rowPathSelect = null;
            $scope.selectedResult = null; // should either clear the selection or prevent the message
          }

          // stop the spinner
          $scope.spinner.stop();

        })
        .error(function (data, status) {
          // need to check for an error because cancelling the request also sends us here
          if (status !== 0) {
            $scope.results = [];
            var msg = 'Похоже что-то пошло не так с сервисом, который предоставляет снимки.';
            $scope.satellite = true;
            $scope.satGif = $sce.trustAsHtml('<img src="images/satellite.gif" />');
            if (data && data.error && data.error.code) {
              if (data.error.code === 'NOT_FOUND') {
                msg = 'Похоже, что вы зашли слишком далеко с приближением к области интереса, поэтому попробуйте отдалиться, чтобы получить данные';
                $scope.satellite = false;
              }
            }
            setInfoPane(msg); // Show nice error message
            $scope.paths = {};
            $scope.rowPathSelect = null;
            $scope.selectedResult = null; // should either clear the selection or prevent the message
            // stop the spinner
            $scope.spinner.stop();
          }
        });
    };


    /**
     * Queries the Api for resources.
     */
    // // NEW_ERA: основная функция для поиска снимков/выполнения запросов к АПИ
    // $scope.execQuery = function() {
    //   // cancel any existing requests and renew canceller
    //   canceller.resolve();
    //   canceller = $q.defer();

    //   // spin!
    //   $scope.spinner.spin(target);

    //   // no satellite gif
    //   $scope.satellite = false;

    //   // check continuity of longitude range (bool)
    //   var continuous =  Math.floor(($scope.bounds.northEast.lng + 180) / 360) === Math.floor(($scope.bounds.southWest.lng + 180) / 360);

    //   $scope.searchString = queryConstructor({
    //     dateRange: [$scope.dateRangeStart, $scope.dateRangeEnd],
    //     limit: 3000,
    //     sceneCenterLatRange: [$scope.bounds.northEast.lat, $scope.bounds.southWest.lat],
    //     // mod function here supports negative modulo in the 'expected fashion'
    //     // we are treating the longitude this way to support multiple rotations around the earth
    //     sceneCenterLonRange: [mod($scope.bounds.northEast.lng + 180, 360) - 180, mod($scope.bounds.southWest.lng + 180, 360) - 180],
    //     continuous: continuous
    //   });

    //   $http.get(endpoint + '/landsat?search=' + $scope.searchString, { timeout: canceller.promise })
    //     .success(function(data) {
    //     setInfoPane(); // Hide info pane so it doesn't flash when results are redrawn

    //     console.log("Выполнили запрос по АПИ и получили результат:", data);


    //     var total = data.meta.found;
    //     $scope.results = [];
    //     $scope.markers = {};
    //     // clear histograms
    //     d3.select('.cloudCoverSlider svg').selectAll('.bar').remove();
    //     d3.select('.sunAzimuthSlider svg').selectAll('.bar').remove();
    //     // only renew results if we have a 'resonable' number
    //     if (total < 3000){
    //       for (var i=0; i < data.results.length; i++){
    //         var scene = data.results[i];
    //         scene.className = scene.sceneID + '-' + scene.row + '-' + scene.path;
    //         scene.lat = scene.sceneCenterLatitude;
    //         // correction for being on "left or right earths"
    //         // we force everything to be in our map range
    //         // rotate according to which part of the range the scene is in
    //         // for continuous ranges, it doesn't matter but this covers all cases
    //         if (scene.sceneCenterLongitude > 0) {
    //           scene.lng = scene.sceneCenterLongitude + Math.floor(($scope.bounds.southWest.lng + 180) / 360) * 360;
    //         }
    //         else {
    //           scene.lng = scene.sceneCenterLongitude + Math.floor(($scope.bounds.northEast.lng + 180) / 360) * 360;
    //         }
    //         scene.icon = {};
    //         scene.icon.type = 'div';
    //         scene.icon.className = 'map-icon text-center';
    //         scene.downloadURL = 'https://storage.googleapis.com/earthengine-public/landsat/L8/' + zeroPad(scene.path,3) + '/' + zeroPad(scene.row,3) + '/' + scene.sceneID + '.tar.bz';
    //         $scope.results.push(scene);
    //       }
    //       updateMarkers();
    //       if ($scope.openFilter === 'cloud' || $scope.openFilter === 'sun' ){
    //         var helperNames = ($scope.openFilter === 'cloud') ? {main:'cloudCover', val: 'cloud_coverage', bound: 100, bin: 20} : {main:'sunAzimuth', val: 'sunAzimuth', bound: 180, bin: 36};
    //         var vals = $scope.results.map(function(result){ return Math.max(result[helperNames.val],0); });
    //         if ($scope.openFilter === 'sun'){
    //           vals = vals.filter(function(sun){ return sun > 0;});
    //         }
    //         var size = getSize($scope.openFilter);
    //         $scope.updateHistogram('.' + helperNames.main + 'Slider', vals, [0, helperNames.bound], helperNames.bin, size);
    //       }
    //     } else {
    //       // Not showing anything because we have too many results, let user know
    //       var msg = 'Слишком много данных, чтобы отобразить их на карте!<br/><br/>' +
    //                 'Попробуйте приблизиться к области интереса или уменьшить диапазон даты.';
    //       setInfoPane(msg); // Show helpful message
    //       // also clear paths and rowPath selection and selectedResult because why not
    //       $scope.paths = {};
    //       $scope.rowPathSelect = null;
    //       $scope.selectedResult = null; // should either clear the selection or prevent the message
    //     }

    //     // stop the spinner
    //     $scope.spinner.stop();
    //   }).error(function (data, status) {
    //     // need to check for an error because cancelling the request also sends us here
    //     if (status !== 0) {
    //       $scope.results = [];
    //       var msg = 'Похоже что-то пошло не так с сервисом, который предоставляет снимки.';
    //       $scope.satellite = true;
    //       $scope.satGif = $sce.trustAsHtml('<img src="images/satellite.gif" />');
    //       if (data && data.error && data.error.code) {
    //         if (data.error.code === 'NOT_FOUND') {
    //           msg = 'Похоже, что вы зашли слишком далеко с приближением к области интереса, поэтому попробуйте отдалиться, чтобы получить данные';
    //           $scope.satellite = false;
    //         }
    //       }
    //       setInfoPane(msg); // Show nice error message
    //       $scope.paths = {};
    //       $scope.rowPathSelect = null;
    //       $scope.selectedResult = null; // should either clear the selection or prevent the message
    //       // stop the spinner
    //       $scope.spinner.stop();
    //     }
    //   });
    // };

    /**
     * Filter function used by ng-repeat.
     * Filters api results locally based on cloudCoverage and sun azimuth.
     *
     * @param {Object} val
     */
    $scope.resultsFilter = function(val) {
      return val.cloud_coverage >= $scope.cloudCoverageMin &&
        val.cloud_coverage <= $scope.cloudCoverageMax &&
        val.sunAzimuth >= $scope.sunAzimuthMin &&
        val.sunAzimuth <= $scope.sunAzimuthMax;
    };

    /**
    * Filter function used by ng-repeat.
    * Filters api results locally based on map selections.
    *
    * @param {Object} val
    */
    $scope.mapSelectionFilter = function(val) {
      if ($scope.rowPathSelect === null) {
        return true;
      }
      else {
        return val.row === $scope.rowPathSelect.row && val.path === $scope.rowPathSelect.path;
      }
    };


    /**
     * Sets the sort field and direction.
     *
     * @param {String} val
     */
    $scope.setSortExpression = function(val) {

      if ($scope.sortField === val) {
        $scope.toggleSortReverse();
      }
      else {
        $scope.sortField = val;
        switch (val) {
          case 'acquisitionDate':
            $scope.sortReverse = true;
            break;
          case 'cloudCoverFull':
            $scope.sortReverse = false;
            break;
          case 'sunAzimuth':
            $scope.sortReverse = false;
            break;
        }
      }
    };

    /**
     * Sets a result as the selected one.
     *
     * @param {Object} result
     */
    $scope.selectResult = function(result) {
      $scope.selectedResult = result;
      $scope.drawMarkerOutline($scope.getMarkerName(result));
    };

    /**
     * Resets the selected result to null.
     *
     */
    $scope.resetSelectedResult = function() {
      $scope.selectedResult = null;
      $scope.conditionalResetPaths();
    };

    /**
    * Resets the paths to an empty object.
    *
    */
    $scope.conditionalResetPaths = function() {
      if ($scope.rowPathSelect === null && $scope.selectedResult === null) {
        $scope.paths = {};
      }
    };

    /**
     * Draws an outline around the selected marker
     *
     * @param {String} markerName
     */

     $scope.drawMarkerOutline = function(markerName) {
       // first checks to see if the marker is on the map, then outlines
       // how would it not be on the map?

       if ($scope.markers[markerName]) {
         // calculate a longitude adjustment object for being off the first earth
         // needs to be unique for each corner to cover edge cases
         var lonCorners = ['upperLeftCornerLongitude','upperRightCornerLongitude','lowerRightCornerLongitude','lowerLeftCornerLongitude'];
         var adjust = {};
         var adjustBound;
         for (var i=0; i < lonCorners.length; i++){
           adjustBound = ($scope.markers[markerName][lonCorners[i]] > 0) ? 'southWest' : 'northEast';
           adjust[lonCorners[i]] = Math.floor(($scope.bounds[adjustBound].lng + 180) / 360) * 360;
         }

         $scope.paths[markerName] = {
           type: 'polygon',
           latlngs: [
           { lat: $scope.markers[markerName].upperLeftCornerLatitude, lng: $scope.markers[markerName].upperLeftCornerLongitude + adjust.upperLeftCornerLongitude},
           { lat: $scope.markers[markerName].upperRightCornerLatitude, lng: $scope.markers[markerName].upperRightCornerLongitude + adjust.upperRightCornerLongitude},
           { lat: $scope.markers[markerName].lowerRightCornerLatitude, lng: $scope.markers[markerName].lowerRightCornerLongitude + adjust.lowerRightCornerLongitude},
           { lat: $scope.markers[markerName].lowerLeftCornerLatitude, lng: $scope.markers[markerName].lowerLeftCornerLongitude + adjust.lowerLeftCornerLongitude}
           ],
           color: '#555',
           weight: 1
         };
       }
     };

     /**
     * Sets the visual filter to display
     *
     * @param {String} openFilter
     */

     $scope.toggleOpenFilter = function(openFilter) {
       $scope.openFilter = ($scope.openFilter !== openFilter) ? openFilter : null;
     };

     $scope.switchOpenFilter = function(){
       var size;
       switch ($scope.openFilter){
         case 'date':
           $scope.newDateFilter();
           break;
         case 'cloud':
           var cloudVals = $scope.results.map(function(result){ return Math.max(result.cloud_coverage,0); });
           size = getSize($scope.openFilter);
           $scope.newFilterGraph(['cloudCoverageMin', 'cloudCoverageMax'], [0, 100], '.cloudCoverSlider', size, '%');
           $scope.updateHistogram('.cloudCoverSlider', cloudVals, [0, 100], 20, size);
           break;
         case 'sun':
           var sunVals = $scope.results.map(function(result){ return Math.max(result.sunAzimuth,0); })
                               .filter(function(sun){ return sun > 0;});
           size = getSize($scope.openFilter);
           $scope.newFilterGraph(['sunAzimuthMin','sunAzimuthMax'], [0, 180], '.sunAzimuthSlider', size, '\xB0');
           $scope.updateHistogram('.sunAzimuthSlider',sunVals, [0, 180], 36, size);
           break;
         case null:
           break;
       }
     };

     /**
     * If we have a selected row/path and the outline is outside the bounds, erase it and clear the rowPathSelect filter
     *
     */

     $scope.cleanPaths = function(){
       if ($scope.rowPathSelect) {
         if (!inBounds($scope.rowPathSelect)){
           $scope.paths = {};
           $scope.rowPathSelect = null;
         }
       }
     };

     /**
     * Toggle sortReverse
     *
     */
     $scope.toggleSortReverse = function() {
       $scope.sortReverse = ($scope.sortReverse) ? false : true;
     };

    /// event listeners

    $scope.$on('leafletDirectiveMarker.mouseover', function(event, args){
      if ($scope.rowPathSelect === null && $scope.selectedResult === null) {
        $scope.drawMarkerOutline(args.markerName);
      }
    });

    $scope.$on('leafletDirectiveMarker.mouseout', function(){
      $scope.conditionalResetPaths();
    });

    $scope.$on('leafletDirectiveMarker.click', function(event, args){
      $scope.paths = {};
      $scope.selectedResult = null;
      $scope.drawMarkerOutline(args.markerName);
      $scope.rowPathSelect = $scope.markers[args.markerName];
    });

    $scope.$on('leafletDirectiveMap.click', function(){
      $scope.rowPathSelect = null;
      $scope.conditionalResetPaths();
    });

    /// d3 and slider logic
    $scope.newDateFilter = function() {
      var dateFirst = Date.parse('February 11, 2013'),  // Landsat 8 launch
      dateRange = Date.now() - dateFirst,
      start = Date.parse($scope.dateRangeStart),
      end = Date.parse($scope.dateRangeEnd);

      jQuery('.date-slider').noUiSlider({
        // Define a range.
        range: {
          min: dateFirst,
          max: dateRange + dateFirst
        },
        connect: true,
        step: 1,

        // Indicate the handle starting positions.
        start: [start, end]

      });

      jQuery('.date-slider').noUiSlider_pips({
        mode: 'values',
        values: [dateFirst,dateFirst + dateRange/4,dateFirst + 2*dateRange/4,dateFirst + 3*dateRange/4,end],
        density: 4,
        stepped: true
      });

      // link the slider to the display
      jQuery('.date-slider').Link('lower').to(jQuery('#lower'), dateFormatAdd);
      jQuery('.date-slider').Link('upper').to(jQuery('#upper'), dateFormatAdd);

      // format the pips post-hoc
      jQuery('.noUi-value').each(function(){ jQuery(this).html(dateFormat(jQuery(this).html())); });

      // only update on mouseup (so we don't continuously trigger the API)
      jQuery('.noUi-handle').on('mousedown',function(){
        jQuery(window).one('mouseup',function(){
          $scope.dateRangeStart = jQuery('#lower').html();
          $scope.dateRangeEnd = jQuery('#upper').html();
          // irresponsible use of apply
          $scope.$apply();
        });
      });
    };

    $scope.newFilterGraph = function(controls, span, className, size, symbol) {

      d3.select(className + ' svg').remove();

      var margin = graphParam.margin;
      var width = size.width - margin.left - margin.right;
      var height = size.height - margin.top - margin.bottom;

      var x = d3.scale.linear()
                .domain([span[0], span[1]])
                .range([0, width]);

      brush[className.slice(1,100)] = d3.svg.brush()
                    .x(x)
                    .extent([$scope[controls[0]],$scope[controls[1]]])
                    .on('brush', brushed);

      var svg = d3.select(className).append('svg')
                  .attr('width', width + margin.left + margin.right)
                  .attr('height', height + margin.top + margin.bottom)
               .append('g')
                  .attr('class','main')
                  .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

      svg.append('rect')
         .attr('class', 'grid-background')
         .attr('width', width)
         .attr('height', height);

      svg.append('g')
         .attr('class', 'x axis')
         .attr('transform', 'translate(0,' + height + ')')
         .call(d3.svg.axis().scale(x).orient('bottom').tickFormat(function(d) { return d + symbol; }));

      var gBrush = svg.append('g')
                      .attr('class', 'brush')
                      .call(brush[className.slice(1,100)]);

      gBrush.selectAll('rect')
            .attr('height', height);

      gBrush.selectAll('.resize').append('path').attr('d', resizePath);

      function brushed() {
        var extent0 = brush[className.slice(1,100)].extent(),
        extent1;

        // if dragging, preserve the width of the extent
        if (d3.event.mode === 'move') {
          var d0 = round(extent0[0],1),
          d1 = Math.round((extent0[1] - extent0[0]) + d0);
          extent1 = [d0, d1];
        }

        // otherwise, if resizing, round both numbers
        else {
          extent1 = extent0.map(function(num){
            return round(num,1);
          });
        }

        d3.select(this).call(brush[className.slice(1,100)].extent(extent1));
        svg.selectAll('.bar').classed('brushed', function(d) {
          return extent1[0] <= (d.x + d.dx - 1) && (d.x + 1) <= extent1[1];
        });
        // if the updates happen too fast, the slider is less responsive
        // purposefully slowing down angular for better UX
        setTimeout(function(){
          $scope[controls[0]] = extent1[0];
          $scope[controls[1]] = extent1[1];
          // irresponsible use of apply to force update
          $scope.$apply();
        },50);

      }
    };

    $scope.updateHistogram = function(graph, vals, span, bins, size) {

      d3.select(graph + ' svg').selectAll('.bar').remove();

      var margin = graphParam.margin;
      var width = size.width - margin.left - margin.right;
      var height = size.height - margin.top - margin.bottom;

      var svg = d3.select(graph + ' .main');

      var x = d3.scale.linear()
                .domain([span[0], span[1]])
                .range([0, width]);

      var data = d3.layout.histogram()
                   .bins(bins)
                   .range([span[0], span[1]])
                   (vals);

      var y = d3.scale.linear()
                .domain([0, d3.max(data, function(d) { return d.y; })])
                .range([height, 0]);

      var bar = svg.selectAll('.bar')
                 .data(data)
                   .enter().append('g')
                   .attr('class', 'bar')
                   .attr('transform', function(d) { return 'translate(' + x(d.x) + ',' + y(d.y) + ')'; });

      bar.append('rect')
         .attr('x', 1)
         .attr('width', x(data[0].dx) - 1)
         .attr('height', function(d) { return height - y(d.y); });

      // delete and redraw brush
      svg.select('.brush').remove();

      var gBrush = svg.append('g')
         .attr('class', 'brush')
         .call(brush[graph.slice(1,100)]);

         gBrush.selectAll('rect')
         .attr('height', height);

         gBrush.selectAll('.resize').append('path').attr('d', resizePath);

      brushed(svg,brush[graph.slice(1,100)].extent());

    };

    $scope.openModal = function () {
      $scope.openFilter = null;
      $scope.modalInstance = $modal.open({
        templateUrl: 'views/modal.html',
        controller: 'MainCtrl',
      });
    };

    $scope.openAdvancedDownload = function () {
      console.log("Кликнули по 'Загрузка каналов'");

      $scope.modalInstance = $modal.open({
        templateUrl: 'views/advanced.html',
        controller: 'AdvancedCtrl',
        size: 'lg',
        resolve: {
          selectedResult: function () {
            console.log($scope.selectedResult);
            return $scope.selectedResult;
          }
        }
      });

      console.log("Объект modalInstance - ", $scope.modalInstance);
    };


    $scope.openWaitingModal = function() {
      console.log("Кликнули по 'Подождите'");

      $scope.modalInstance = $modal.open({
        templateUrl: 'views/waiting.html',
        controller: 'ProcessingCtrl',
        size: 'lg',
        resolve: {
          selectedResult: function () {

            return $scope.selectedResult;
          }
        }
      });

      console.log("Объект modalInstance - ", $scope.modalInstance);
    };


    $scope.openProcessingDownload = function() {
      console.log("Кликнули по 'Обработка'");

      $scope.modalInstance = $modal.open({
        templateUrl: 'views/processingDownload.html',
        controller: 'ProcessingCtrl',
        size: 'lg',
        resolve: {
          selectedResult: function () {
            return $scope.selectedResult;
          }
        }
      });

      console.log("Объект modalInstance - ", $scope.modalInstance);
    };

    /**
    * sends a google analytics click event for download tracking
    *
    */

    $scope.downloadTrack = function() {
      ga('send', 'event', 'download', 'click', $scope.selectedResult.sceneID);
    };


    ////////////////////////////////////////////////////////////
    ///////////    Helper functions    /////////////////////////
    ////////////////////////////////////////////////////////////

    $scope.getMarkerName = function(result) {
      return 'r' + result.row + 'p' + result.path;
    };

    function updateMarkers() {
      $scope.results.forEach(function(result){
        if ($scope.resultsFilter(result)){
          var rowPathObj = $scope.markers[$scope.getMarkerName(result)];
          if (rowPathObj){
            rowPathObj.icon.iconSize = [30, 30];
            if (rowPathObj.icon.html === '') {
              rowPathObj.icon.html = 2;
            }
            else {
              rowPathObj.icon.html++;
            }
          }
          else {
            $scope.markers[$scope.getMarkerName(result)] = result;
            $scope.markers[$scope.getMarkerName(result)].icon.html = '';
            $scope.markers[$scope.getMarkerName(result)].icon.iconSize = [20, 20];
          }
        }
      });
    }




    //NEW_ARA: НОВАЯ функция для конструирования параметров в GET запросе к НОВОМУ АПИ

    function NEW_ERA_QUERY_CONSTRUCTOR(options) {

      const collectionName = "landsat-8-l1"; // нужен только ландсат

      const queryObj = {"collection" : {"eq" : collectionName}}
      const serializedJson = JSON.stringify(queryObj);
      const encodedStr = encodeURIComponent(serializedJson);

      let queryStr = `?query=${encodedStr}`;

      const dateRangeOrigin = options.dateRange || ['2014-01-01', '2015-01-05'];

      queryStr += `&time=${dateRangeOrigin[0]}/${dateRangeOrigin[1]}`; // фильтруем по дате

      if (options.limit) {
        queryStr += `&limit=${options.limit}`; // ограничиваем количество снимков
      }

      const latMinMaxRanges = options.sceneCenterLatRange.sort(sortNumber) || ['-90', '90']; // получаем границы широт текущего экстента, чтобы сформировать bbox

      if (options.continuous) console.log("Continous присутствует в параметрах!") // в прошлой ревизии этот параметр на что-то влиял, нужно проверить, если что-то пойдет не так

      const lonMinMaxRanges = options.sceneCenterLonRange.sort(sortNumber) || ['-180', '180']; // получаем границы долгот текущего экстента, чтобы сформировать bbox

      const bbox = [parseFloat(lonMinMaxRanges[0].toFixed(4)), parseFloat(latMinMaxRanges[0].toFixed(4)), parseFloat(lonMinMaxRanges[1].toFixed(4)), parseFloat(latMinMaxRanges[1].toFixed(4))]

      queryStr += `&bbox=[${bbox}]`; // это ограничивает область поиска до текущего экстента юзера

      return queryStr;
    }


    //NEW_ARA: функция для конструирования параметров в GET запросе к АПИ

    function queryConstructor (options) {
      var queryString;
      var query = [];


      //NEW_ERA: GET /search?time=2019-01-01/2019-02-02 -> пример установки параметров в строке запроса для периода времени

      //NEW_ERA: ЧТОБЫ ПЕРЕДАВАТЬ QUERY В GET НЕОБХОДИМО:
      // 1. СДЕЛАТЬ ОБЪЕКТ QUERY КАК В ДОКЕ: {"eo:cloud_cover":{"lt":50}}
      // 2. ПРЕВРАТИТЬ ЭТОТ ОБЪЕКТ В СТРОКУ ЧЕРЕЗ JSON.stringify(object)
      // 3. ЗАКОДИРОВАТЬ СТРОКУ ДЛЯ ВСТАВКИ В URL ЧЕРЕЗ encodeURIComponent(str)
      // 4. ВСТАВИТЬ ИТОГОВУЮ СТРОКУ В GET ПАРАМЕТР ?query=


      //NEW_ERA: для поиска ландсатовских только снимков, в query необходимо добавить свойство: "collection" : {"eq":"landsat-8-l1"}
      // для сентинела 2 => "collection":{"eq":"sentinel-2-l1c"}
      // если оба спутника => не указывать collection совсем!

      // dateRange -- array of date strings. format: [YYYY-MM-DD,YYYY-MM-DD]
      var dateRange = options.dateRange || ['2014-01-01', '2015-01-05'];
      query.push(arrayHelper(dateRange, 'acquisitionDate'));

      // sceneCenterLatRange -- array of floats specifying the scene centroid latitude. e.g. [4.3, 78.9]
      var sceneCenterLatRange = options.sceneCenterLatRange.sort(sortNumber) || ['-90', '90'];
      query.push(arrayHelper(sceneCenterLatRange, 'sceneCenterLatitude'));

      // sceneCenterLonRange -- array of floats specifying the scene centroid longitude. e.g. [4.3, 78.9]
      // also uses options.continuous to decide if we need two separate ranges to wrap around the 180th meridian
      if (options.continuous) {
        var sceneCenterLonRange = options.sceneCenterLonRange.sort(sortNumber) || ['-180', '180'];
        query.push(arrayHelper(sceneCenterLonRange, 'sceneCenterLongitude'));
      } else {
        var range1 = [-180,options.sceneCenterLonRange.sort(sortNumber)[0]];
        var range2 = [options.sceneCenterLonRange.sort(sortNumber)[1],180];
        query.push('(' + arrayHelper(range1, 'sceneCenterLongitude') + '+OR+' + arrayHelper(range2, 'sceneCenterLongitude') + ')');
      }

      queryString = query.join('+AND+');

      // limit -- integer specifying the maximum results return.
      if (options.limit) {
        queryString += '&limit=' + options.limit;
      }

      // skip: integer specifying the number of results to skip
      if (options.skip) {
        queryString += '&skip=' + options.skip;
      }
      queryString += '&fields=sceneCenterLatitude,sceneCenterLongitude,sunAzimuth,cloud_coverage,path,row,sceneID,aws_thumbnail,acquisitionDate,product_id,upperLeftCornerLatitude,upperLeftCornerLongitude,upperRightCornerLatitude,upperRightCornerLongitude,lowerLeftCornerLatitude,lowerLeftCornerLongitude,lowerRightCornerLatitude,lowerRightCornerLongitude'

      return queryString;
    }

    function arrayHelper(range,field) {
      return field + ':[' + range[0] + '+TO+' + range[1] + ']';
    }

    function sortNumber(a,b) {
      return a - b;
    }

    function zeroPad(n,c) {
      var s = String(n);
      if (s.length < c) {
        return zeroPad('0' + n,c);
      }
      else {
        return s;
      }
    }

    function round(num, rounder){
      return rounder * Math.round(num / rounder);
    }

    function brushed(svg,extent){
      svg.selectAll('.bar').classed('brushed', function(d) {
        return extent[0] <= (d.x + d.dx - 1) && (d.x + 1) <= extent[1];
      });
    }

    function dateFormat(date){
      return $filter('date')(Number(date), 'yyyy-MM');
    }

    function dateFormatAdd(date){
      jQuery(this).html($filter('date')(Number(date), 'yyyy-MM-dd'));
    }

    function getSize(className) {
      var size = {};
      size.width = Number(d3.select('.' + className + '-container').style('width').slice(0,-2));
      size.height = Number(d3.select('.' + className + '-container').style('height').slice(0,-2));
      return size;
    }

    function resizePath(d) {
      var e = +(d === 'e'),
      x = e ? 1 : -1;
      // hardcoding for now
      var height = 80;
      var y = height / 3;
      return 'M' + (0.5 * x) + ',' + y +
      'A6,6 0 0 ' + e + ' ' + (6.5 * x) + ',' + (y + 6) +
      'V' + (2 * y - 6) +
      'A6,6 0 0 ' + e + ' ' + (0.5 * x) + ',' + (2 * y) +
      'Z' +
      'M' + (2.5 * x) + ',' + (y + 8) +
      'V' + (2 * y - 8) +
      'M' + (4.5 * x) + ',' + (y + 8) +
      'V' + (2 * y - 8);
    }

    function inBounds(result) {
      return result.sceneCenterLatitude <= $scope.bounds.northEast.lat % 360 &&
      result.sceneCenterLatitude >= $scope.bounds.southWest.lat % 360 &&
      result.sceneCenterLongitude >= $scope.bounds.southWest.lng % 360 &&
      result.sceneCenterLongitude <= $scope.bounds.northEast.lng % 360;
    }

    function mod(number, dividend) {
      return ((number % dividend) + dividend) % dividend;
    }

  }]);
