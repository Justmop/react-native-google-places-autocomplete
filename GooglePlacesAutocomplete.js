import React, { Component } from "react";
import PropTypes from "prop-types";
import {
  TextInput,
  View,
  FlatList,
  Image,
  Text,
  StyleSheet,
  Dimensions,
  TouchableHighlight,
  Platform,
  ActivityIndicator,
  PixelRatio,
} from "react-native";
import Qs from "qs";
import debounce from "lodash.debounce";

const WINDOW = Dimensions.get("window");

const defaultStyles = {
  container: {
    paddingTop: 16,
  },
  textInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    paddingLeft: 8,
  },
  textInput: {
    backgroundColor: "#FFFFFF",
    height: 28,
    borderRadius: 5,
    paddingTop: 4.5,
    paddingBottom: 4.5,
    paddingRight: 10,
    marginLeft: 8,
    marginRight: 8,
    fontSize: 15,
    flex: 1,
  },
  poweredContainer: {
    justifyContent: "flex-end",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  powered: {},
  listView: {},
  row: {
    flexDirection: "row",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#c8c7cc",
  },
  description: {},
  loader: {
    flexDirection: "row",
    justifyContent: "flex-end",
    height: 20,
    marginRight: 16,
  },
  androidLoader: {
    marginRight: -15,
  },
};

export default class GooglePlacesAutocomplete extends Component {
  _isMounted = false;
  _results = [];
  _requests = [];
  textInput = null;
  _debouncing = undefined;

  constructor(props) {
    super(props);
    this.state = this.getInitialState.call(this);
  }

  getInitialState = () => ({
    text: this.props.getDefaultValue(),
    dataSource: this.buildRowsFromResults([]),
    listViewDisplayed:
      this.props.listViewDisplayed === "auto"
        ? false
        : this.props.listViewDisplayed,
  });

  setAddressText = (address) => this.setState({ text: address });

  getAddressText = () => this.state.text;

  buildRowsFromResults = (results) => {
    let res = [];

    if (
      results.length === 0 ||
      this.props.predefinedPlacesAlwaysVisible === true
    ) {
      res = [...this.props.predefinedPlaces];

      if (this.props.currentLocation === true) {
        res.unshift({
          description: this.props.currentLocationLabel,
          isCurrentLocation: true,
        });
      }
    }

    res = res.map((place) => ({
      ...place,
      isPredefinedPlace: true,
    }));

    return [...res, ...results];
  };

  componentWillMount() {
    if (this.props.debounce) {
      this._debouncing = debounce(this._request, this.props.debounce);
      this._request = this._debouncing;
    }
  }

  componentDidMount() {
    // This will load the default value's search results after the view has
    // been rendered
    this._handleChangeText(this.state.text);
    this._isMounted = true;
  }

  componentWillReceiveProps(nextProps) {
    let listViewDisplayed = true;

    if (nextProps.listViewDisplayed !== "auto") {
      listViewDisplayed = nextProps.listViewDisplayed;
    }

    if (
      typeof nextProps.text !== "undefined" &&
      this.state.text !== nextProps.text
    ) {
      this.setState(
        {
          listViewDisplayed: listViewDisplayed,
        },
        this._handleChangeText(nextProps.text)
      );
    } else {
      this.setState({
        listViewDisplayed: listViewDisplayed,
      });
    }
  }

  componentWillUnmount() {
    this._abortRequests();
    this._isMounted = false;

    if (this._debouncing) {
      this._debouncing.cancel();
    }
  }

  _abortRequests = () => {
    this._requests.map((i) => i.abort());
    this._requests = [];
  };

  /**
   * This method is exposed to parent components to focus on textInput manually.
   * @public
   */
  triggerFocus = () => {
    if (this.textInput) this.textInput.focus();
  };

  /**
   * This method is exposed to parent components to blur textInput manually.
   * @public
   */
  triggerBlur = () => {
    if (this.textInput) this.textInput.blur();
  };

  getCurrentLocation = () => {
    let options = {
      enableHighAccuracy: false,
      timeout: 20000,
      maximumAge: 1000,
    };

    if (this.props.enableHighAccuracyLocation && Platform.OS === "android") {
      options = {
        enableHighAccuracy: true,
        timeout: 20000,
      };
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (this.props.nearbyPlacesAPI === "None") {
          let currentLocation = {
            description: this.props.currentLocationLabel,
            geometry: {
              location: {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
              },
            },
          };

          this._disableRowLoaders();
          this.props.onPress(currentLocation, currentLocation);
        } else {
          this._requestNearby(
            position.coords.latitude,
            position.coords.longitude
          );
        }
      },
      (error) => {
        this._disableRowLoaders();
        alert(error.message);
      },
      options
    );
  };

  _onPress = (rowData) => {
    if (
      rowData.isPredefinedPlace !== true &&
      this.props.fetchDetails === true
    ) {
      if (rowData.isLoading === true) {
        // already requesting
        return;
      }

      this._abortRequests();

      // display loader
      this._enableRowLoader(rowData);

      // fetch details
      const request = new XMLHttpRequest();
      this._requests.push(request);
      request.timeout = this.props.timeout;
      request.ontimeout = this.props.onTimeout;
      request.onreadystatechange = () => {
        if (request.readyState !== 4) return;

        if (request.status === 200) {
          const responseJSON = JSON.parse(request.responseText);

          if (responseJSON.status === "OK") {
            if (this._isMounted === true) {
              const details = responseJSON.result;
              this._disableRowLoaders();
              this._onBlur();

              this.setState({
                text: this._renderDescription(rowData),
              });

              delete rowData.isLoading;
              this.props.onPress(rowData, details);
            }
          } else {
            this._disableRowLoaders();

            if (this.props.autoFillOnNotFound) {
              this.setState({
                text: this._renderDescription(rowData),
              });
              delete rowData.isLoading;
            }

            if (!this.props.onNotFound) {
              console.warn(
                "google places autocomplete: " + responseJSON.status
              );
            } else {
              this.props.onNotFound(responseJSON);
            }
          }
        } else {
          this._disableRowLoaders();

          if (!this.props.onFail) {
            console.warn(
              "google places autocomplete: request could not be completed or has been aborted"
            );
          } else {
            this.props.onFail();
          }
        }
      };

      request.open(
        "GET",
        "https://maps.googleapis.com/maps/api/place/details/json?" +
          Qs.stringify({
            key: this.props.query.key,
            placeid: rowData.place_id,
            language: this.props.query.language,
          })
      );

      if (this.props.query.origin) {
        request.setRequestHeader("Referer", this.props.query.origin);
      }

      request.send();
    } else if (rowData.isCurrentLocation === true) {
      // display loader
      this._enableRowLoader(rowData);
      this.setState({
        text: this._renderDescription(rowData),
      });

      this.triggerBlur(); // hide keyboard but not the results
      delete rowData.isLoading;
      this.getCurrentLocation();
    } else {
      this.setState({
        text: this._renderDescription(rowData),
      });

      this._onBlur();
      delete rowData.isLoading;
      let predefinedPlace = this._getPredefinedPlace(rowData);

      // sending predefinedPlace as details for predefined places
      this.props.onPress(predefinedPlace, predefinedPlace);
    }
  };

  _enableRowLoader = (rowData) => {
    let rows = this.buildRowsFromResults(this._results);
    for (let i = 0; i < rows.length; i++) {
      if (
        rows[i].place_id === rowData.place_id ||
        (rows[i].isCurrentLocation === true &&
          rowData.isCurrentLocation === true)
      ) {
        rows[i].isLoading = true;
        this.setState({
          dataSource: rows,
        });
        break;
      }
    }
  };

  _disableRowLoaders = () => {
    if (this._isMounted === true) {
      for (let i = 0; i < this._results.length; i++) {
        if (this._results[i].isLoading === true) {
          this._results[i].isLoading = false;
        }
      }

      this.setState({
        dataSource: this.buildRowsFromResults(this._results),
      });
    }
  };

  _getPredefinedPlace = (rowData) => {
    if (rowData.isPredefinedPlace !== true) {
      return rowData;
    }

    for (let i = 0; i < this.props.predefinedPlaces.length; i++) {
      if (this.props.predefinedPlaces[i].description === rowData.description) {
        return this.props.predefinedPlaces[i];
      }
    }

    return rowData;
  };

  _filterResultsByTypes = (unfilteredResults, types) => {
    if (types.length === 0) return unfilteredResults;

    const results = [];
    for (let i = 0; i < unfilteredResults.length; i++) {
      let found = false;

      for (let j = 0; j < types.length; j++) {
        if (unfilteredResults[i].types.indexOf(types[j]) !== -1) {
          found = true;
          break;
        }
      }

      if (found === true) {
        results.push(unfilteredResults[i]);
      }
    }
    return results;
  };

  _requestNearby = (latitude, longitude) => {
    this._abortRequests();

    const queryString = Qs.stringify({
      location: latitude + "," + longitude,
      key: this.props.query.key,
      ...this.props.GooglePlacesSearchQuery,
    });

    if (
      latitude !== undefined &&
      longitude !== undefined &&
      latitude !== null &&
      longitude !== null
    ) {
      const request = new XMLHttpRequest();
      this._requests.push(request);
      request.timeout = this.props.timeout;
      request.ontimeout = this.props.onTimeout;
      request.onreadystatechange = () => {
        if (request.readyState !== 4) {
          return;
        }

        if (request.status === 200) {
          const responseJSON = JSON.parse(request.responseText);

          this._disableRowLoaders();

          if (typeof responseJSON.results !== "undefined") {
            if (this._isMounted === true) {
              var results = [];
              if (this.props.nearbyPlacesAPI === "GoogleReverseGeocoding") {
                results = this._filterResultsByTypes(
                  responseJSON.results,
                  this.props.filterReverseGeocodingByTypes
                );
              } else {
                results = responseJSON.results;
              }

              this.setState({
                dataSource: this.buildRowsFromResults(results),
              });
            }
          }
          if (typeof responseJSON.error_message !== "undefined") {
            console.warn(
              "google places autocomplete: " + responseJSON.error_message
            );
          }
        } else {
          // console.warn("google places autocomplete: request could not be completed or has been aborted");
        }
      };

      let url = "";
      if (this.props.nearbyPlacesAPI === "GoogleReverseGeocoding") {
        // your key must be allowed to use Google Maps Geocoding API
        url =
          "https://maps.googleapis.com/maps/api/geocode/json?" +
          Qs.stringify({
            latlng: latitude + "," + longitude,
            key: this.props.query.key,
            ...this.props.GoogleReverseGeocodingQuery,
          });
      } else {
        url =
          "https://maps.googleapis.com/maps/api/place/nearbysearch/json?" +
          queryString;
      }

      request.open("GET", url);
      if (this.props.query.origin) {
        request.setRequestHeader("Referer", this.props.query.origin);
      }

      request.send();
    } else {
      this._results = [];
      this.setState({
        dataSource: this.buildRowsFromResults([]),
      });
    }
  };

  _request = (text) => {
    this._abortRequests();
    if (text.length >= this.props.minLength) {
      const request = new XMLHttpRequest();
      this._requests.push(request);
      request.timeout = this.props.timeout;
      request.ontimeout = this.props.onTimeout;
      request.onreadystatechange = () => {
        if (request.readyState !== 4) {
          return;
        }

        if (request.status === 200) {
          const responseJSON = JSON.parse(request.responseText);
          if (typeof responseJSON.predictions !== "undefined") {
            if (this._isMounted === true) {
              const results =
                this.props.nearbyPlacesAPI === "GoogleReverseGeocoding"
                  ? this._filterResultsByTypes(
                      responseJSON.predictions,
                      this.props.filterReverseGeocodingByTypes
                    )
                  : responseJSON.predictions;

              this._results = results;
              this.setState({
                dataSource: this.buildRowsFromResults(results),
              });
            }
          }
          if (typeof responseJSON.error_message !== "undefined") {
            console.warn(
              "google places autocomplete: " + responseJSON.error_message
            );
          }
        } else {
          // console.warn("google places autocomplete: request could not be completed or has been aborted");
        }
        this.setState({ loading: false });
      };
      const queryString = Qs.stringify(this.props.query);

      const url = !this.props.filterSearch
        ? `https://maps.googleapis.com/maps/api/place/autocomplete/json?&radius=50000&location=${this.props.latitude},${this.props.longitude}&input=`
        : "https://maps.googleapis.com/maps/api/place/autocomplete/json?&input=";
      request.open("GET", url + encodeURIComponent(text) + "&" + queryString);
      if (this.props.query.origin) {
        request.setRequestHeader("Referer", this.props.query.origin);
      }

      request.send();
    } else {
      this._results = [];
      this.setState({
        dataSource: this.buildRowsFromResults([]),
      });
    }
  };

  _onChangeText = (text) => {
    if (!text) {
      this.setState({ loading: false });
    }
    if (text.length >= this.props.minLength) {
      this.setState({ loading: true });
    }
    this._request(text);

    this.setState({
      text: text,
      listViewDisplayed: this._isMounted || this.props.autoFocus,
    });
  };

  _handleChangeText = (text) => {
    this._onChangeText(text);

    const onChangeText =
      this.props &&
      this.props.textInputProps &&
      this.props.textInputProps.onChangeText;

    if (onChangeText) {
      onChangeText(text);
    }
  };

  _getRowLoader() {
    return (
      <ActivityIndicator
        animating={true}
        color={Platform.OS === "android" ? "#49a361" : undefined}
        size="small"
      />
    );
  }

  _renderRowData = (rowData) => {
    if (this.props.renderRow) {
      return this.props.renderRow(rowData);
    }

    return (
      <Text
        style={{
          flex: 1,
          textAlign: "left",
          fontFamily: "HKGrotesk-Regular",
          fontSize: 16,
          fontWeight: "normal",
          lineHeight: 24,
          letterSpacing: 0,
          color: "rgba(0, 0, 0, 0.87)",
          marginRight: 16,
        }}
        numberOfLines={this.props.numberOfLines}
      >
        {this._renderDescription(rowData)}
      </Text>
    );
  };

  _renderDescription = (rowData) => {
    if (this.props.renderDescription) {
      return this.props.renderDescription(rowData);
    }

    return rowData.description || rowData.formatted_address || rowData.name;
  };

  _renderLoader = (rowData) => {
    if (rowData.isLoading === true) {
      return (
        <View
          style={[
            this.props.suppressDefaultStyles ? {} : defaultStyles.loader,
            this.props.styles.loader,
          ]}
        >
          {this._getRowLoader()}
        </View>
      );
    }

    return null;
  };

  _renderRow = (rowData = {}, sectionID, rowID) => {
    return (
      <TouchableHighlight
        testID={`places_list_item_${sectionID}`}
        style={[
          {
            width: WINDOW.width,
            height: 72,
            justifyContent: "center",
          },
          this.props.styles.rowContainer,
        ]}
        onPress={() => this._onPress(rowData)}
        underlayColor={this.props.listUnderlayColor || "#c8c7cc"}
      >
        <View
          style={[
            this.props.suppressDefaultStyles ? {} : defaultStyles.row,
            this.props.styles.row,
            rowData.isPredefinedPlace ? this.props.styles.specialItemRow : {},
            { alignItems: "center" },
          ]}
        >
          <Image
            source={require("../../src/images/pin.png")}
            style={[
              {
                width: 24,
                height: 24,
                marginRight: 8,
                marginLeft: 16,
              },
              this.props.styles.rowPinImage,
            ]}
          />
          {this._renderRowData(rowData)}
          {this._renderLoader(rowData)}
        </View>
      </TouchableHighlight>
    );
  };

  _renderSeparator = (sectionID, rowID) => {
    if (rowID == this.state.dataSource.length - 1) {
      return null;
    }

    return (
      <View
        key={`${sectionID}-${rowID}`}
        style={[
          this.props.suppressDefaultStyles ? {} : defaultStyles.separator,
          this.props.styles.separator,
        ]}
      />
    );
  };

  _onBlur = () => {
    this.triggerBlur();

    this.setState({
      listViewDisplayed: false,
    });
  };

  _onFocus = () => this.setState({ listViewDisplayed: true });

  _renderPoweredLogo = () => {
    if (!this._shouldShowPoweredLogo()) {
      return null;
    }

    return (
      <View
        style={[
          this.props.suppressDefaultStyles ? {} : defaultStyles.row,
          defaultStyles.poweredContainer,
          this.props.styles.poweredContainer,
        ]}
      >
        <Image
          style={[
            this.props.suppressDefaultStyles ? {} : defaultStyles.powered,
            this.props.styles.powered,
          ]}
          resizeMode="contain"
          source={require("./images/powered_by_google_on_white.png")}
        />
      </View>
    );
  };

  _shouldShowPoweredLogo = () => {
    if (
      !this.props.enablePoweredByContainer ||
      this.state.dataSource.length == 0
    ) {
      return false;
    }

    for (let i = 0; i < this.state.dataSource.length; i++) {
      let row = this.state.dataSource[i];

      if (
        !row.hasOwnProperty("isCurrentLocation") &&
        !row.hasOwnProperty("isPredefinedPlace")
      ) {
        return true;
      }
    }

    return false;
  };

  _renderLeftButton = () => {
    if (this.props.renderLeftButton) {
      return this.props.renderLeftButton();
    }
  };

  _renderRightButton = () => {
    if (this.props.renderRightButton) {
      return this.props.renderRightButton();
    }
  };

  _getFlatList = () => {
    const keyGenerator = () => Math.random().toString(36).substr(2, 10);
    if (
      (this.state.text !== "" ||
        this.props.predefinedPlaces.length ||
        this.props.currentLocation === true) &&
      this.state.listViewDisplayed === true
    ) {
      return (
        <View style={{ height: WINDOW.height }}>
          <FlatList
            style={[
              this.props.suppressDefaultStyles ? {} : defaultStyles.listView,
              this.props.styles.listView,
            ]}
            data={this.state.dataSource}
            keyExtractor={keyGenerator}
            extraData={[this.state.dataSource, this.props]}
            ItemSeparatorComponent={this._renderSeparator}
            renderItem={({ item, index }) => this._renderRow(item, index)}
            contentContainerStyle={{ flex: 1 }}
            ListFooterComponent={this._renderPoweredLogo}
            {...this.props}
          />
        </View>
      );
    }

    return null;
  };
  render() {
    let { onFocus, ...userProps } = this.props.textInputProps;

    const isSearchListOpen =
      (this.state.text !== "" ||
        this.props.predefinedPlaces.length ||
        this.props.currentLocation === true) &&
      this.state.listViewDisplayed === true;

    return (
      <View
        style={[
          this.props.suppressDefaultStyles ? {} : defaultStyles.container,
          this.props.styles.container,
          {
            backgroundColor: isSearchListOpen ? "white" : "transparent",
          },
        ]}
        // pointerEvents="box-none"
      >
        {!this.props.textInputHide && (
          <View
            style={[
              this.props.suppressDefaultStyles
                ? {}
                : defaultStyles.textInputContainer,
              this.props.styles.textInputContainer,
            ]}
          >
            {this.state.loading
              ? this._getRowLoader()
              : this._renderLeftButton()}
            <View
              style={{
                height: 50,
                flex: 1,
                justifyContent: "center",
                borderRadius: 5,
              }}
            >
              <TextInput
                testID="google_places_auto_complete"
                ref={(ref) => (this.textInput = ref)}
                editable={this.props.editable}
                returnKeyType={this.props.returnKeyType}
                autoFocus={this.props.autoFocus}
                style={[
                  this.props.suppressDefaultStyles
                    ? {}
                    : defaultStyles.textInput,
                  this.props.styles.textInput,
                  { maxHeight: 31 },
                ]}
                value={this.state.text}
                placeholder={this.props.placeholder}
                onSubmitEditing={this.props.onSubmitEditing}
                placeholderTextColor={this.props.placeholderTextColor}
                onFocus={
                  onFocus
                    ? () => {
                        this._onFocus();
                        onFocus();
                      }
                    : this._onFocus
                }
                clearButtonMode="while-editing"
                underlineColorAndroid={this.props.underlineColorAndroid}
                {...userProps}
                onChangeText={this._handleChangeText}
              />
            </View>
            {this._renderRightButton()}
          </View>
        )}
        {this.props.children}
        {this._getFlatList()}
      </View>
    );
  }
}

GooglePlacesAutocomplete.propTypes = {
  placeholder: PropTypes.string,
  placeholderTextColor: PropTypes.string,
  underlineColorAndroid: PropTypes.string,
  returnKeyType: PropTypes.string,
  onPress: PropTypes.func,
  onNotFound: PropTypes.func,
  onFail: PropTypes.func,
  minLength: PropTypes.number,
  fetchDetails: PropTypes.bool,
  autoFocus: PropTypes.bool,
  autoFillOnNotFound: PropTypes.bool,
  getDefaultValue: PropTypes.func,
  timeout: PropTypes.number,
  onTimeout: PropTypes.func,
  query: PropTypes.object,
  GoogleReverseGeocodingQuery: PropTypes.object,
  GooglePlacesSearchQuery: PropTypes.object,
  styles: PropTypes.object,
  textInputProps: PropTypes.object,
  enablePoweredByContainer: PropTypes.bool,
  predefinedPlaces: PropTypes.array,
  currentLocation: PropTypes.bool,
  currentLocationLabel: PropTypes.string,
  nearbyPlacesAPI: PropTypes.string,
  enableHighAccuracyLocation: PropTypes.bool,
  filterReverseGeocodingByTypes: PropTypes.array,
  predefinedPlacesAlwaysVisible: PropTypes.bool,
  enableEmptySections: PropTypes.bool,
  renderDescription: PropTypes.func,
  renderRow: PropTypes.func,
  renderLeftButton: PropTypes.func,
  renderRightButton: PropTypes.func,
  listUnderlayColor: PropTypes.string,
  debounce: PropTypes.number,
  isRowScrollable: PropTypes.bool,
  text: PropTypes.string,
  textInputHide: PropTypes.bool,
  suppressDefaultStyles: PropTypes.bool,
  numberOfLines: PropTypes.number,
  onSubmitEditing: PropTypes.func,
  editable: PropTypes.bool,
};
GooglePlacesAutocomplete.defaultProps = {
  placeholder: "Search",
  placeholderTextColor: "#A8A8A8",
  isRowScrollable: true,
  underlineColorAndroid: "transparent",
  returnKeyType: "default",
  onPress: () => {},
  onNotFound: () => {},
  onFail: () => {},
  minLength: 0,
  fetchDetails: false,
  autoFocus: false,
  autoFillOnNotFound: false,
  keyboardShouldPersistTaps: "always",
  getDefaultValue: () => "",
  timeout: 20000,
  onTimeout: () => console.warn("google places autocomplete: request timeout"),
  query: {
    key: "missing api key",
    language: "en",
    types: "geocode",
  },
  GoogleReverseGeocodingQuery: {},
  GooglePlacesSearchQuery: {
    rankby: "distance",
    types: "food",
  },
  styles: {},
  textInputProps: {},
  enablePoweredByContainer: true,
  predefinedPlaces: [],
  currentLocation: false,
  currentLocationLabel: "Current location",
  nearbyPlacesAPI: "GooglePlacesSearch",
  enableHighAccuracyLocation: true,
  filterReverseGeocodingByTypes: [],
  predefinedPlacesAlwaysVisible: false,
  enableEmptySections: true,
  listViewDisplayed: "auto",
  debounce: 0,
  textInputHide: false,
  suppressDefaultStyles: false,
  numberOfLines: 1,
  onSubmitEditing: () => {},
  editable: true,
};

// this function is still present in the library to be retrocompatible with version < 1.1.0
const create = function create(options = {}) {
  return React.createClass({
    render() {
      return (
        <GooglePlacesAutocomplete ref="GooglePlacesAutocomplete" {...options} />
      );
    },
  });
};

module.exports = {
  GooglePlacesAutocomplete,
  create,
};
